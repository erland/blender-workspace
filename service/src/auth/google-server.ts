import {createHash,createHmac,createPrivateKey,createPublicKey,randomBytes,timingSafeEqual,
 type KeyObject} from 'node:crypto';
import {createLocalJWKSet,createRemoteJWKSet,jwtVerify,SignJWT,type JWK} from 'jose';
import type {Pool} from 'pg';
import {GoogleOAuthStore,type OAuthClient,type GrantRecord,type RefreshRecord} from './google-store.js';
import {READ_SCOPE,WRITE_SCOPE} from './oauth.js';

const GOOGLE_AUTH='https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN='https://oauth2.googleapis.com/token';
const GOOGLE_JWKS='https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS=['https://accounts.google.com','accounts.google.com'];
const CHALLENGE=/^[A-Za-z0-9_-]{43}$/;
const VERIFIER=/^[A-Za-z0-9._~-]{43,128}$/;
const MAX_CLIENTS_PER_MINUTE=20;
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const random=()=>randomBytes(32).toString('base64url');

export interface GoogleAuthConfig {
  publicOrigin:string;googleClientId:string;googleClientSecret:string;
  signingKey:KeyObject;sessionSecret:string;
  allowedEmails:string[];allowedRedirectOrigins:string[];
  allowLocalRedirects:boolean;
}
export interface GoogleIdentity {subject:string;email?:string;verified:boolean;}
export interface GoogleIdentityProvider {
  authorizeUrl(state:string,nonce:string,callback:string):string;
  exchangeAndVerify(code:string,callback:string,nonce:string):Promise<GoogleIdentity>;
}
export class LiveGoogleProvider implements GoogleIdentityProvider {
  private jwks=createRemoteJWKSet(new URL(GOOGLE_JWKS));
  constructor(private readonly config:GoogleAuthConfig){}
  authorizeUrl(state:string,nonce:string,callback:string):string {
    const url=new URL(GOOGLE_AUTH);
    for(const [key,value] of Object.entries({
      client_id:this.config.googleClientId,redirect_uri:callback,response_type:'code',
      scope:'openid email profile',state,nonce,prompt:'select_account'
    }))url.searchParams.set(key,value);
    return url.toString();
  }
  async exchangeAndVerify(code:string,callback:string,nonce:string):Promise<GoogleIdentity> {
    const body=new URLSearchParams({grant_type:'authorization_code',code,
      client_id:this.config.googleClientId,client_secret:this.config.googleClientSecret,
      redirect_uri:callback});
    const response=await fetch(GOOGLE_TOKEN,{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded'},body,
      signal:AbortSignal.timeout(10_000)});
    if(!response.ok)throw new Error('Google exchange failed');
    const json=await response.json() as {id_token?:string};
    if(!json.id_token)throw new Error('Google identity missing');
    const {payload}=await jwtVerify(json.id_token,this.jwks,{
      issuer:GOOGLE_ISSUERS,audience:this.config.googleClientId,algorithms:['RS256']});
    if(typeof payload.sub!=='string'||!payload.sub||payload.nonce!==nonce||
      payload.email_verified!==true)throw new Error('Google identity invalid');
    return {subject:payload.sub,verified:true,
      ...(typeof payload.email==='string'?{email:payload.email}:{})};
  }
}
type Pending={kind?:'settings';state:string;nonce:string;expires:number;clientId:string;
  redirect:string;scope:string;resource:string;challenge:string;clientState?:string};
const b64=(s:string)=>Buffer.from(s,'utf8').toString('base64url');
interface SettingsSession {ownerKey:string;csrf:string;expires:number;}
function error(code:string,status=400){
  return {status,body:{error:code},headers:{'cache-control':'no-store'}};
}
export class GoogleOAuthServer {
  readonly store:GoogleOAuthStore;
  readonly jwks: {keys:Record<string,unknown>[]};
  readonly verifierKeys:ReturnType<typeof createLocalJWKSet>;
  private readonly provider:GoogleIdentityProvider;
  private readonly key:KeyObject;
  private registrationTimes:number[]=[];
  constructor(readonly config:GoogleAuthConfig,pool:Pool,provider?:GoogleIdentityProvider){
    this.store=new GoogleOAuthStore(pool);
    this.key=config.signingKey;
    const pub=createPublicKey(this.key).export({format:'jwk'}) as Record<string,unknown>;
    const jwk={...pub,alg:'EdDSA',use:'sig',kid:'bw-oauth-1'};
    this.jwks={keys:[jwk]};
    this.verifierKeys=createLocalJWKSet(this.jwks as {keys:JWK[]});
    this.provider=provider??new LiveGoogleProvider(config);
  }
  get issuer(){return this.config.publicOrigin;}
  get resource(){return this.config.publicOrigin+'/mcp';}
  get callback(){return this.config.publicOrigin+'/auth/google/callback';}
  metadata(){
    return {issuer:this.issuer,authorization_endpoint:this.issuer+'/authorize',
      token_endpoint:this.issuer+'/token',registration_endpoint:this.issuer+'/register',
      jwks_uri:this.issuer+'/jwks',scopes_supported:[READ_SCOPE,WRITE_SCOPE],
      response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],
      code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],
      authorization_response_iss_parameter_supported:true};
  }
  private signature(encoded:string):string{
    return createHmac('sha256',this.config.sessionSecret).update(encoded).digest('base64url');
  }
  private signedPending(p:Pending):string{
    const encoded=b64(JSON.stringify(p));return encoded+'.'+this.signature(encoded);
  }
  private readPending(cookie:string|undefined):Pending|undefined{
    const value=cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('bw_oauth_pending='))?.slice(17);
    if(!value||value.length>4096)return undefined;
    const [encoded,signature,...rest]=value.split('.');
    if(!encoded||!signature||rest.length)return undefined;
    const one=Buffer.from(signature),two=Buffer.from(this.signature(encoded));
    if(one.length!==two.length||!timingSafeEqual(one,two))return undefined;
    try{
      const p=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')) as Pending;
      return p.expires>Date.now()&&typeof p.state==='string'&&typeof p.nonce==='string'?p:undefined;
    }catch{return undefined;}
  }
  async beginSettingsLogin(){
    const pending:Pending={kind:'settings',state:random(),nonce:random(),
      expires:Date.now()+600_000,clientId:'',redirect:'',scope:'',
      resource:this.resource,challenge:''};
    return {status:302,body:'',headers:{
      location:this.provider.authorizeUrl(pending.state,pending.nonce,this.callback),
      'set-cookie':this.cookie(this.signedPending(pending),600),
      'cache-control':'no-store'
    }};
  }
  private settingsCookie(value:string,maxAge:number):string{
    return 'bw_modal_settings='+value+'; Path=/settings; HttpOnly; SameSite=Lax; Secure; Max-Age='+maxAge;
  }
  settingsSession(cookie:string|undefined):SettingsSession|undefined {
    const value=cookie?.split(';').map(x=>x.trim())
      .find(x=>x.startsWith('bw_modal_settings='))?.slice('bw_modal_settings='.length);
    if(!value||value.length>3000)return undefined;
    const [encoded,signature,...rest]=value.split('.');
    if(!encoded||!signature||rest.length)return undefined;
    const one=Buffer.from(signature),two=Buffer.from(this.signature(encoded));
    if(one.length!==two.length||!timingSafeEqual(one,two))return undefined;
    try{
      const session=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')) as SettingsSession;
      return session.expires>Date.now()&&typeof session.ownerKey==='string'&&
        /^oauth:[a-f0-9]{64}$/.test(session.ownerKey)&&
        typeof session.csrf==='string'&&session.csrf.length>=32?session:undefined;
    }catch{return undefined;}
  }
  logoutSettings(){
    return {status:303,body:'',headers:{
      location:'/', 'set-cookie':this.settingsCookie('',0),'cache-control':'no-store'
    }};
  }
  private cookie(value:string,maxAge:number):string{
    return 'bw_oauth_pending='+value+'; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age='+maxAge;
  }
  async register(input:unknown){
    const now=Date.now();
    this.registrationTimes=this.registrationTimes.filter(t=>now-t<60_000);
    if(this.registrationTimes.length>=MAX_CLIENTS_PER_MINUTE)return error('temporarily_unavailable',429);
    this.registrationTimes.push(now);
    if(!input||typeof input!=='object')return error('invalid_client_metadata');
    const obj=input as Record<string,unknown>;
    if(!Array.isArray(obj.redirect_uris)||obj.redirect_uris.length<1||obj.redirect_uris.length>10||
      obj.redirect_uris.some(x=>typeof x!=='string'||x.length>2048||!this.safeRedirect(x)))
      return error('invalid_redirect_uri');
    if(obj.token_endpoint_auth_method!==undefined&&obj.token_endpoint_auth_method!=='none')
      return error('invalid_client_metadata');
    if(obj.client_name!==undefined&&
      (typeof obj.client_name!=='string'||obj.client_name.length>200))return error('invalid_client_metadata');
    const client:OAuthClient={clientId:'bwc_'+random(),redirectUris:obj.redirect_uris as string[],
      name:typeof obj.client_name==='string'?obj.client_name:''};
    await this.store.register(client);
    return {status:201,body:{client_id:client.clientId,redirect_uris:client.redirectUris,
      client_name:client.name,token_endpoint_auth_method:'none',
      grant_types:['authorization_code','refresh_token'],response_types:['code']},
      headers:{'cache-control':'no-store'}};
  }
  private safeRedirect(value:string):boolean {
    try {
      const url=new URL(value);
      if(url.hash||url.username||url.password)return false;
      if(url.protocol!=='https:'&&!(this.config.allowLocalRedirects&&url.protocol==='http:'&&
          ['localhost','127.0.0.1'].includes(url.hostname)))return false;
      return this.config.allowedRedirectOrigins.includes(url.origin);
    }catch{return false;}
  }
  async authorize(query:Record<string,unknown>){
    const get=(key:string)=>typeof query[key]==='string'?query[key] as string:'';
    if(get('response_type')!=='code')return error('unsupported_response_type');
    if(get('resource')!==this.resource)return error('invalid_target');
    if(get('code_challenge_method')!=='S256'||!CHALLENGE.test(get('code_challenge')))
      return error('invalid_request');
    const scopes=get('scope').split(/\s+/).filter(Boolean);
    if(!scopes.length||scopes.some(s=>s!==READ_SCOPE&&s!==WRITE_SCOPE))return error('invalid_scope');
    const client=await this.store.client(get('client_id'));
    if(!client||!client.redirectUris.includes(get('redirect_uri')))return error('invalid_client');
    const pending:Pending={state:random(),nonce:random(),expires:Date.now()+600_000,
      clientId:client.clientId,redirect:get('redirect_uri'),scope:[...new Set(scopes)].join(' '),
      resource:this.resource,challenge:get('code_challenge'),
      ...(get('state')?{clientState:get('state')}: {})};
    return {status:302,body:'',headers:{location:this.provider.authorizeUrl(
      pending.state,pending.nonce,this.callback),
      'set-cookie':this.cookie(this.signedPending(pending),600),
      'cache-control':'no-store'}};
  }
  async callbackLogin(query:Record<string,unknown>,cookie?:string){
    const pending=this.readPending(cookie);
    if(!pending||query.state!==pending.state||typeof query.code!=='string'||
      !query.code)return error('invalid_request');
    let identity:GoogleIdentity;
    try{identity=await this.provider.exchangeAndVerify(query.code,this.callback,pending.nonce);}
    catch{return error('access_denied',403);}
    if(!identity.verified||!identity.subject||identity.subject.length>512)
      return error('access_denied',403);
    if(this.config.allowedEmails.length>0&&
      (!identity.email||!this.config.allowedEmails.includes(identity.email.toLowerCase())))
      return error('access_denied',403);
    if(pending.kind==='settings'){
      const ownerKey='oauth:'+hash(this.issuer+'\\0'+identity.subject);
      const session:SettingsSession={ownerKey,csrf:random(),expires:Date.now()+8*3600_000};
      const encoded=b64(JSON.stringify(session));
      return {status:302,body:'',headers:{
        location:'/settings',
        'set-cookie':[this.cookie('',0),
          this.settingsCookie(encoded+'.'+this.signature(encoded),8*3600)],
        'cache-control':'no-store'
      }};
    }
    const code=random();
    await this.store.saveCode(hash(code),{
      clientId:pending.clientId,redirectUri:pending.redirect,
      googleSubject:identity.subject,...(identity.email?{email:identity.email}:{}),
      scope:pending.scope,resource:pending.resource,challenge:pending.challenge});
    const redirect=new URL(pending.redirect);
    redirect.searchParams.set('code',code);
    redirect.searchParams.set('iss',this.issuer);
    if(pending.clientState)redirect.searchParams.set('state',pending.clientState);
    return {status:302,body:'',headers:{location:redirect.toString(),
      'set-cookie':this.cookie('',0),'cache-control':'no-store'}};
  }
  async token(form:Record<string,string>) {
    if(form.grant_type==='authorization_code'){
      const code=form.code;
      const verifier=form.code_verifier;
      if(!code||!verifier||!VERIFIER.test(verifier)||!form.client_id||!form.redirect_uri)
        return error('invalid_request');
      const challenge=createHash('sha256').update(verifier).digest('base64url');
      const grant=await this.store.consumeCode(hash(code),form.client_id,form.redirect_uri,
        challenge,form.resource);
      if(!grant)
        return error('invalid_grant');
      return this.issue(grant);
    }
    if(form.grant_type==='refresh_token'){
      if(!form.refresh_token||!form.client_id)return error('invalid_request');
      const grant=await this.store.consumeRefresh(hash(form.refresh_token),form.client_id,form.resource);
      if(!grant)
        return error('invalid_grant');
      return this.issue(grant);
    }
    return error('unsupported_grant_type');
  }
  private async issue(record:GrantRecord|RefreshRecord){
    const access=await new SignJWT({scope:record.scope}).setProtectedHeader({
      alg:'EdDSA',kid:'bw-oauth-1',typ:'at+jwt'})
      .setIssuer(this.issuer).setAudience(this.resource).setSubject(record.googleSubject)
      .setIssuedAt().setExpirationTime('1h').sign(this.key);
    const refresh=random();
    await this.store.saveRefresh(hash(refresh),{clientId:record.clientId,
      googleSubject:record.googleSubject,...(record.email?{email:record.email}:{}),
      scope:record.scope,resource:record.resource});
    return {status:200,body:{access_token:access,token_type:'Bearer',
      expires_in:3600,scope:record.scope,refresh_token:refresh},
      headers:{'cache-control':'no-store','pragma':'no-cache'}};
  }
}
export function loadGoogleAuthConfig(env:NodeJS.ProcessEnv,publicOrigin:string):GoogleAuthConfig{
  for(const field of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET',
    'OAUTH_SIGNING_KEY','OAUTH_SESSION_SECRET','GOOGLE_ALLOWED_REDIRECT_ORIGINS']) {
    if(!env[field])throw new Error(field+' is required for Google auth');
  }
  if((env.OAUTH_SESSION_SECRET??'').length<32)throw new Error('OAUTH_SESSION_SECRET must be at least 32 characters');
  let key:KeyObject;
  try{
    key=createPrivateKey({key:Buffer.from(env.OAUTH_SIGNING_KEY!,'base64'),format:'der',type:'pkcs8'});
  }catch{throw new Error('OAUTH_SIGNING_KEY must be base64 PKCS8 DER');}
  if(key.asymmetricKeyType!=='ed25519')throw new Error('OAUTH_SIGNING_KEY must be an Ed25519 key');
  const allowedRedirectOrigins=(env.GOOGLE_ALLOWED_REDIRECT_ORIGINS??'').split(',')
    .map(s=>s.trim()).filter(Boolean).map(s=>new URL(s).origin);
  if(!allowedRedirectOrigins.length)throw new Error('No allowed redirect origins');
  return {publicOrigin,googleClientId:env.GOOGLE_CLIENT_ID!,
    googleClientSecret:env.GOOGLE_CLIENT_SECRET!,signingKey:key,
    sessionSecret:env.OAUTH_SESSION_SECRET!,
    allowedEmails:(env.GOOGLE_ALLOWED_EMAILS??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean),
    allowedRedirectOrigins,
    allowLocalRedirects:env.NODE_ENV==='test'&&env.OAUTH_ALLOW_LOCAL_TEST==='true'};
}
