import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet} from 'jose';
import {createApp} from '../dist/app.js';
import {loadConfig} from '../dist/config.js';
import {verifyOAuthAccessToken,protectedResourceMetadata} from '../dist/auth/oauth.js';

const origin='http://127.0.0.1:3000';
const issuer='https://auth.example.org/realms/blender';
async function fixture(){
 const {publicKey,privateKey}=await generateKeyPair('RS256');
 const jwk=await exportJWK(publicKey);jwk.kid='test-key';jwk.alg='RS256';jwk.use='sig';
 const keys=createLocalJWKSet({keys:[jwk]});
 const settings={issuer,resource:origin,jwksUri:'https://auth.example.org/jwks'};
 async function issue({sub='alice',aud=origin,iss=issuer,scope='workspace:read workspace:write',exp='2h'}={}){
   return new SignJWT({scope}).setProtectedHeader({alg:'RS256',kid:'test-key'})
     .setIssuedAt().setIssuer(iss).setAudience(aud).setSubject(sub).setExpirationTime(exp).sign(privateKey);
 }
 return {keys,settings,issue};
}
test('signed OAuth tokens require correct signature, issuer, audience, expiry and scopes',async()=>{
 const f=await fixture();
 const alice=await verifyOAuthAccessToken(await f.issue(),f.settings,f.keys);
 const again=await verifyOAuthAccessToken(await f.issue(),f.settings,f.keys);
 const bob=await verifyOAuthAccessToken(await f.issue({sub:'bob'}),f.settings,f.keys);
 assert.equal(alice.ownerKey,again.ownerKey);
 assert.notEqual(alice.ownerKey,bob.ownerKey);
 assert.match(alice.ownerKey,/^oauth:[0-9a-f]{64}$/);
 const badAud=await f.issue({aud:'https://unrelated.example'});
 const badIss=await f.issue({iss:'https://unrelated.example'});
 const badScopes=await f.issue({scope:'email profile'});
 const expired=await f.issue({exp:-120});
 for(const token of [badAud,badIss,badScopes,expired])
   await assert.rejects(()=>verifyOAuthAccessToken(token,f.settings,f.keys));
});
test('OAuth startup rejects partial settings and insecure remote issuer',()=>{
 const env={PUBLIC_ORIGIN:'https://blender.example.org',MCP_AUTH_MODE:'oauth',
   OAUTH_ISSUER:issuer,OAUTH_JWKS_URI:'https://auth.example.org/jwks'};
 const cfg=loadConfig(env);
 assert.equal(cfg.oauth.resource,'https://blender.example.org');
 assert.deepEqual(protectedResourceMetadata(cfg.oauth).authorization_servers,[issuer]);
 assert.throws(()=>loadConfig({...env,OAUTH_JWKS_URI:undefined}));
 assert.throws(()=>loadConfig({...env,OAUTH_ISSUER:'http://auth.example.org'}));
 assert.throws(()=>loadConfig({...env,MCP_OWNER_KEY:'shared'}));
 assert.throws(()=>loadConfig({...env,MCP_ACCESS_TOKEN:'c'.repeat(48)}));
});
test('OAuth MCP endpoint advertises metadata and challenges bad tokens',async t=>{
 const f=await fixture();
 const cfg=loadConfig({PUBLIC_ORIGIN:origin,MCP_AUTH_MODE:'oauth',OAUTH_ISSUER:issuer,
   OAUTH_JWKS_URI:f.settings.jwksUri,OAUTH_ALLOW_LOCAL_TEST:'true',NODE_ENV:'test'});
 const app=createApp(cfg,{projects:{list:async()=>[]},jobs:{}},{keys:f.keys});
 await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const base='http://127.0.0.1:'+app.server.address().port;
 const meta=await fetch(base+'/.well-known/oauth-protected-resource');
 assert.equal(meta.status,200);
 assert.equal((await meta.json()).resource,origin);
 const body=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}});
 async function request(token){
   const response=await fetch(base+'/mcp',{method:'POST',headers:{
     'content-type':'application/json','accept':'application/json, text/event-stream',
     ...(token?{authorization:'Bearer '+token}:{})},body});
   return {status:response.status,headers:response.headers,text:await response.text()};
 }
 const none=await request();
 assert.equal(none.status,401);
 assert.match(none.headers.get('www-authenticate'),/resource_metadata/);
 assert.equal((await request('invalid')).status,401);
 const good=await request(await f.issue());
 assert.equal(good.status,200,good.text);
 assert.match(good.text,/workspace_list_projects/);
 assert.match(good.text,/securitySchemes/);
 assert.match(good.text,/workspace:write/);
});
