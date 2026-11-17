import {createHash} from 'node:crypto';
import {createLocalJWKSet,createRemoteJWKSet,jwtVerify,type JWTPayload} from 'jose';

export const READ_SCOPE='workspace:read';
export const WRITE_SCOPE='workspace:write';
export interface OAuthSettings {issuer:string;jwksUri:string;resource:string;}
export interface Principal {ownerKey:string;scopes:ReadonlySet<string>;}
export type Jwks = ReturnType<typeof createRemoteJWKSet> | ReturnType<typeof createLocalJWKSet>;

export function protectedResourceMetadata(settings:OAuthSettings) {
  return {
    resource:settings.resource,
    authorization_servers:[settings.issuer],
    scopes_supported:[READ_SCOPE,WRITE_SCOPE]
  };
}
export function bearerChallenge(settings:OAuthSettings):string {
  return 'Bearer resource_metadata="'+settings.resource+'/.well-known/oauth-protected-resource", scope="'+READ_SCOPE+' '+WRITE_SCOPE+'"';
}
export function remoteJwks(settings:OAuthSettings):Jwks {
  return createRemoteJWKSet(new URL(settings.jwksUri),{timeoutDuration:5000,cooldownDuration:30000});
}
export async function verifyOAuthAccessToken(token:string,settings:OAuthSettings,keys:Jwks):Promise<Principal> {
  // Asymmetric signatures only; fail closed on audience, issuer, lifetime and scopes.
  const {payload}=await jwtVerify(token,keys,{issuer:settings.issuer,
    audience:settings.resource,algorithms:['RS256','ES256','EdDSA'],clockTolerance:5});
  if (!payload.sub || typeof payload.sub!=='string' || payload.sub.length>512 ||
      typeof payload.exp!=='number' || !Number.isSafeInteger(payload.exp))
    throw new Error('Missing subject or expiration');
  const scope=payload.scope;
  if(typeof scope!=='string')throw new Error('Missing OAuth scope');
  const scopes=new Set(scope.split(/\s+/).filter(Boolean));
  if(!scopes.has(READ_SCOPE) && !scopes.has(WRITE_SCOPE))throw new Error('Missing workspace scope');
  const digest=createHash('sha256').update(settings.issuer+'\0'+payload.sub).digest('hex');
  return {ownerKey:'oauth:'+digest,scopes};
}
