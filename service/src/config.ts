import {timingSafeEqual} from 'node:crypto';
import type {OAuthSettings} from './auth/oauth.js';
import {loadGoogleAuthConfig,type GoogleAuthConfig} from './auth/google-server.js';

export interface ServiceConfig {
  host:string; port:number; accessToken:string;publicOrigin:string;ownerKey?:string;
  authMode:'internal'|'oauth'|'google';oauth?:OAuthSettings;google?:GoogleAuthConfig;
}
function validateUrl(value:string,label:string,allowLocal=false):string {
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||
      (label==='PUBLIC_ORIGIN'&&url.pathname!=='/'))
    throw new Error(label+' invalid URL');
  if(url.protocol!=='https:'&&!(allowLocal&&url.protocol==='http:'&&
      ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))
    throw new Error(label+' must use HTTPS');
  return label==='PUBLIC_ORIGIN'?url.origin:value.replace(/\/$/,'');
}
export function loadConfig(env:NodeJS.ProcessEnv=process.env):ServiceConfig {
  const authMode=env.MCP_AUTH_MODE??'internal';
  if(authMode!=='oauth'&&authMode!=='google'&&authMode!=='internal')throw new Error('Invalid MCP_AUTH_MODE');
  const allowLocal=env.OAUTH_ALLOW_LOCAL_TEST==='true'&&env.NODE_ENV==='test';
  const publicOrigin=validateUrl(env.PUBLIC_ORIGIN??'','PUBLIC_ORIGIN',authMode==='internal'||allowLocal);
  const port=Number(env.PORT??'3000');
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
  const accessToken=env.MCP_ACCESS_TOKEN??'';
  const ownerKey=env.MCP_OWNER_KEY;
  if(ownerKey!==undefined&&(!ownerKey.trim()||ownerKey.length>200))
    throw new Error('Invalid MCP_OWNER_KEY');
  if(authMode==='google'){
    if(ownerKey||accessToken)throw new Error('Legacy bearer token/owner not allowed in Google mode');
    const google=loadGoogleAuthConfig(env,publicOrigin);
    return {host:env.HOST??'0.0.0.0',port,accessToken:'',publicOrigin,
      authMode,google,oauth:{issuer:publicOrigin,jwksUri:publicOrigin+'/jwks',resource:publicOrigin}};
  }
  if(authMode==='internal'){
    if(accessToken.length<32)throw new Error('MCP_ACCESS_TOKEN must contain at least 32 characters');
    return {host:env.HOST??'0.0.0.0',port,accessToken,publicOrigin,ownerKey,authMode};
  }
  if(ownerKey||accessToken)throw new Error('Legacy owner or token prohibited in OAuth mode');
  if(!env.OAUTH_ISSUER||!env.OAUTH_JWKS_URI)throw new Error('OAuth issuer and JWKS URI required');
  const issuer=validateUrl(env.OAUTH_ISSUER,'OAUTH_ISSUER',allowLocal);
  const jwksUri=validateUrl(env.OAUTH_JWKS_URI,'OAUTH_JWKS_URI',allowLocal);
  return {host:env.HOST??'0.0.0.0',port,accessToken:'',publicOrigin,authMode,
    oauth:{issuer,jwksUri,resource:publicOrigin}};
}
export function authorized(header:string|undefined,token:string):boolean {
  const value=header?.startsWith('Bearer ')?header.slice(7):'';
  const a=Buffer.from(value),b=Buffer.from(token);
  return a.length===b.length&&timingSafeEqual(a,b);
}
