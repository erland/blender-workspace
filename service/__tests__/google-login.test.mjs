import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../dist/app.js';
import {loadConfig} from '../dist/config.js';
import {GoogleOAuthServer} from '../dist/auth/google-server.js';
import {applyMigrations} from '../dist/db/migrations.js';
import {ProjectRepository} from '../dist/db/projects.js';
import {JobRepository} from '../dist/jobs/job-repository.js';
import {ModalAccountManager} from '../dist/modal/modal-accounts.js';

test('Google login completes DCR, PKCE, bearer MCP, refresh rotation, scope and identity isolation',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:8});
  await applyMigrations(pool);
  const {privateKey}=generateKeyPairSync('ed25519');
  const pem=privateKey.export({format:'der',type:'pkcs8'}).toString('base64');
  const env={NODE_ENV:'test',OAUTH_ALLOW_LOCAL_TEST:'true',MCP_AUTH_MODE:'google',
    PUBLIC_ORIGIN:'http://127.0.0.1:3000',
    GOOGLE_CLIENT_ID:'google-client-id',GOOGLE_CLIENT_SECRET:'google-client-secret',
    OAUTH_SIGNING_KEY:pem,OAUTH_SESSION_SECRET:'s'.repeat(64),
    GOOGLE_ALLOWED_REDIRECT_ORIGINS:'https://chatgpt.com',
    GOOGLE_ALLOWED_EMAILS:'alice@example.org,bob@example.org'};
  const config=loadConfig(env);
  assert.equal(config.oauth.issuer,config.publicOrigin);
  assert.equal(config.oauth.resource,config.publicOrigin+'/mcp');
  assert.throws(()=>loadConfig({...env,OAUTH_SIGNING_KEY:undefined}));
  assert.throws(()=>loadConfig({...env,GOOGLE_ALLOWED_REDIRECT_ORIGINS:undefined}));
  const provider={
    authorizeUrl(state,nonce,callback){
      const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');
      u.searchParams.set('state',state);u.searchParams.set('nonce',nonce);
      u.searchParams.set('redirect_uri',callback);return u.toString();
    },
    async exchangeAndVerify(code,callback,nonce){
      assert.equal(callback,'http://127.0.0.1:3000/auth/google/callback');
      assert.ok(nonce.length>24);
      if(code==='alice')return {subject:'google-alice',email:'alice@example.org',verified:true};
      if(code==='bob')return {subject:'google-bob',email:'bob@example.org',verified:true};
      if(code==='blocked')return {subject:'google-other',email:'other@example.org',verified:true};
      throw new Error('Invalid Google code');
    }
  };
  const google=new GoogleOAuthServer(config.google,pool,provider);
  const accounts=new ModalAccountManager(pool,randomBytes(32),{async verify(token){
    if(token.tokenSecret==='invalid')throw new Error('Modal refused credentials');
  }});
  const app=createApp(config,{
    projects:new ProjectRepository(pool),jobs:new JobRepository(pool),modalAccounts:accounts
  },{google});
  await app.listen({host:'127.0.0.1',port:0});
  const base='http://127.0.0.1:'+app.server.address().port;
  const projects=[];
  const settingsOwner='oauth:'+createHash('sha256').update(config.publicOrigin+String.fromCharCode(0)+'google-alice').digest('hex');
  t.after(async()=>{
    try{
      await pool.query('DELETE FROM bw_modal_accounts WHERE owner_key=$1',[settingsOwner]);
      for(const projectId of projects){
        await pool.query('DELETE FROM bw_jobs WHERE project_id=$1',[projectId]);
        await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[projectId]);
        await pool.query('DELETE FROM bw_projects WHERE id=$1',[projectId]);
      }
    }finally{await app.close();await pool.end();}
  });
  const get=async(url,opts={})=>fetch(base+url,{redirect:'manual',...opts});
  const tokenForm=async(data)=>{
    const r=await get('/token',{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams(data)});
    return {status:r.status,data:await r.json()};
  };
  const discovery=await get('/.well-known/oauth-authorization-server');
  assert.equal(discovery.status,200);
  assert.equal((await discovery.json()).code_challenge_methods_supported[0],'S256');
  const resource=await get('/.well-known/oauth-protected-resource/mcp');
  assert.equal(resource.status,200);
  assert.equal((await resource.json()).resource,config.oauth.resource);
  const jwks=await get('/jwks');assert.equal((await jwks.json()).keys[0].alg,'EdDSA');
  const invalid=await get('/register',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({redirect_uris:['https://evil.example/callback']})});
  assert.equal(invalid.status,400);
  const registration=await get('/register',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({redirect_uris:['https://chatgpt.com/connector/callback'],
      client_name:'ChatGPT test',token_endpoint_auth_method:'none'})});
  assert.equal(registration.status,201);
  const clientId=(await registration.json()).client_id;
  const verifier='v'.repeat(64);
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  const authBase={response_type:'code',client_id:clientId,
    redirect_uri:'https://chatgpt.com/connector/callback',
    scope:'workspace:read workspace:write',resource:config.oauth.resource,
    code_challenge:challenge,code_challenge_method:'S256',state:'client-state'};
  async function login(who,scopes='workspace:read workspace:write'){
    const auth=new URLSearchParams({...authBase,scope:scopes});
    const start=await get('/authorize?'+auth);
    assert.equal(start.status,302);
    const googleUrl=new URL(start.headers.get('location'));
    assert.equal(googleUrl.hostname,'accounts.google.com');
    const cookie=start.headers.get('set-cookie').split(';')[0];
    const denied=await get('/auth/google/callback?'+new URLSearchParams({state:'wrong',code:who}),
      {headers:{cookie}});
    assert.equal(denied.status,400);
    const callback=await get('/auth/google/callback?'+new URLSearchParams({
      state:googleUrl.searchParams.get('state'),code:who}),{headers:{cookie}});
    if(who==='blocked'){assert.equal(callback.status,403);return null;}
    assert.equal(callback.status,302);
    const redirect=new URL(callback.headers.get('location'));
    assert.equal(redirect.origin,'https://chatgpt.com');
    assert.equal(redirect.searchParams.get('state'),'client-state');
    assert.equal(redirect.searchParams.get('iss'),config.publicOrigin);
    const code=redirect.searchParams.get('code');
    // Invalid client/redirect/PKCE/resource must NOT consume the one-time code.
    for(const invalidParams of [
      {code_verifier:'w'.repeat(64)},
      {client_id:'unknown-client'},
      {redirect_uri:'https://chatgpt.com/wrong-callback'},
      {resource:'https://unrelated.example/mcp'}
    ]){
      const bad=await tokenForm({grant_type:'authorization_code',
        client_id:clientId,redirect_uri:authBase.redirect_uri,code,code_verifier:verifier,
        resource:config.oauth.resource,...invalidParams});
      assert.equal(bad.status,400,JSON.stringify(bad.data));
    }
    const exchanged=await tokenForm({grant_type:'authorization_code',
      client_id:clientId,redirect_uri:authBase.redirect_uri,
      code,code_verifier:verifier,resource:config.oauth.resource});
    assert.equal(exchanged.status,200,JSON.stringify(exchanged.data));
    const replay=await tokenForm({grant_type:'authorization_code',client_id:clientId,
      redirect_uri:authBase.redirect_uri,code,code_verifier:verifier});
    assert.equal(replay.status,400);
    return exchanged.data;
  }
  // Interactive settings flow: signed Google session, CSRF and no credential disclosure.
  const settingsStart=await get('/settings/login');
  assert.equal(settingsStart.status,302);
  const settingsGoogle=new URL(settingsStart.headers.get('location'));
  const loginCookie=settingsStart.headers.get('set-cookie').split(';')[0];
  const settingsCallback=await get('/auth/google/callback?'+new URLSearchParams({
    state:settingsGoogle.searchParams.get('state'),code:'alice'
  }),{headers:{cookie:loginCookie}});
  assert.equal(settingsCallback.status,302);
  assert.equal(settingsCallback.headers.get('location'),'/settings');
  const sessionSetCookie=settingsCallback.headers.get('set-cookie');
  const sessionValue=sessionSetCookie.match(/bw_modal_settings=([^;]+)/)?.[1];
  assert.ok(sessionValue,'missing signed Google settings session');
  const sessionCookie='bw_modal_settings='+sessionValue;
  const settingsPage=await get('/settings',{headers:{cookie:sessionCookie}});
  assert.equal(settingsPage.status,200);
  const html=await settingsPage.text();
  assert.match(html,/Ej ansluten/);
  const csrf=html.match(/name="csrf" value="([^"]+)"/)?.[1];
  assert.ok(csrf);
  const submit=async(action,form,headers={})=>get('/settings/'+action,{
    method:'POST',headers:{cookie:sessionCookie,origin:config.publicOrigin,
      'content-type':'application/x-www-form-urlencoded',...headers},
    body:new URLSearchParams({csrf,...form})
  });
  assert.equal((await submit('modal/save',{tokenId:'ak-alice',tokenSecret:'as-alice'},
    {origin:'https://attacker.invalid'})).status,403);
  assert.equal((await submit('modal/save',{csrf:'invalid',tokenId:'ak-alice',tokenSecret:'as-alice'})).status,403);
  const invalidAccount=await submit('modal/save',{tokenId:'bad',tokenSecret:'invalid'});
  assert.equal(invalidAccount.status,303);
  assert.equal((await accounts.status(settingsOwner)).connected,false);
  const connected=await submit('modal/save',{tokenId:'ak-alice',tokenSecret:'as-alice'});
  assert.equal(connected.status,303);
  assert.equal((await accounts.status(settingsOwner)).connected,true);
  const connectedPage=await get('/settings',{headers:{cookie:sessionCookie}});
  const connectedText=await connectedPage.text();
  assert.match(connectedText,/Ansluten/);
  assert.ok(!connectedText.includes('as-alice'),'Modal secret must not appear in browser HTML');
  assert.equal((await submit('modal/test',{})).status,303);
  assert.equal((await submit('modal/disconnect',{})).status,303);
  assert.equal((await accounts.status(settingsOwner)).connected,false);
  assert.equal((await submit('logout',{})).status,303);

  await login('blocked');
  const alice=await login('alice');
  const bob=await login('bob');
  const readonly=await login('alice','workspace:read');
  let id=1;
  async function call(token,name,args={}){
    const response=await get('/mcp',{method:'POST',
      headers:{authorization:'Bearer '+token,'content-type':'application/json',
        accept:'application/json, text/event-stream'},
      body:JSON.stringify({jsonrpc:'2.0',id:id++,method:'tools/call',
        params:{name,arguments:args}})});
    const raw=await response.text();assert.equal(response.status,200,raw);
    const data=raw.split('\n').find(x=>x.startsWith('data:'));
    return (data?JSON.parse(data.slice(5)):JSON.parse(raw)).result;
  }
  function output(r){assert.equal(r.isError,undefined,JSON.stringify(r));return JSON.parse(r.content[0].text);}
  const p=output(await call(alice.access_token,'workspace_create_project',{name:'Google monster'})).project;
  projects.push(p.id);
  assert.equal(output(await call(alice.access_token,'workspace_list_projects')).projects.some(x=>x.id===p.id),true);
  assert.equal(output(await call(bob.access_token,'workspace_list_projects')).projects.some(x=>x.id===p.id),false);
  assert.equal((await call(bob.access_token,'workspace_get_project',{projectId:p.id})).isError,true);
  assert.equal((await call(readonly.access_token,'workspace_create_project',{name:'not allowed'})).isError,true);
  assert.equal(output(await call(readonly.access_token,'workspace_get_project',{projectId:p.id})).project.id,p.id);
  const wrongRefresh=await tokenForm({grant_type:'refresh_token',client_id:clientId,
    refresh_token:alice.refresh_token,resource:'https://unrelated.example/mcp'});
  assert.equal(wrongRefresh.status,400);
  const refreshed=await tokenForm({grant_type:'refresh_token',client_id:clientId,
    refresh_token:alice.refresh_token,resource:config.oauth.resource});
  assert.equal(refreshed.status,200);
  assert.equal(output(await call(refreshed.data.access_token,'workspace_get_project',{projectId:p.id})).project.id,p.id);
  assert.equal((await tokenForm({grant_type:'refresh_token',client_id:clientId,
    refresh_token:alice.refresh_token})).status,400);
  const parallel=await Promise.all(Array.from({length:2},()=>tokenForm({
    grant_type:'refresh_token',client_id:clientId,refresh_token:bob.refresh_token,
    resource:config.oauth.resource})));
  assert.deepEqual(parallel.map(x=>x.status).sort(),[200,400]);
});
