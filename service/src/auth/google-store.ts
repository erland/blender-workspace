import type {Pool} from 'pg';
export interface OAuthClient {clientId:string;redirectUris:string[];name:string;}
export interface GrantRecord {
  clientId:string;redirectUri:string;googleSubject:string;
  email?:string;scope:string;resource:string;challenge:string;
}
export interface RefreshRecord {
  clientId:string;googleSubject:string;email?:string;scope:string;resource:string;
}
export class GoogleOAuthStore {
  constructor(private readonly pool:Pool) {}
  async register(client:OAuthClient):Promise<void> {
    await this.pool.query('INSERT INTO bw_oauth_clients(client_id,redirect_uris,client_name) VALUES($1,$2,$3)',
      [client.clientId,JSON.stringify(client.redirectUris),client.name]);
  }
  async client(id:string):Promise<OAuthClient|undefined> {
    const r=await this.pool.query<{client_id:string;redirect_uris:string[];client_name:string}>(
      'SELECT client_id,redirect_uris,client_name FROM bw_oauth_clients WHERE client_id=$1',[id]);
    const c=r.rows[0];
    return c?{clientId:c.client_id,redirectUris:c.redirect_uris,name:c.client_name}:undefined;
  }
  async saveCode(hash:string,record:GrantRecord):Promise<void> {
    await this.pool.query(`INSERT INTO bw_oauth_codes
     (code_hash,client_id,redirect_uri,google_subject,identity_email,scope,resource,pkce_challenge,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '5 minutes')`,
     [hash,record.clientId,record.redirectUri,record.googleSubject,record.email??null,
      record.scope,record.resource,record.challenge]);
  }
  async consumeCode(hash:string):Promise<GrantRecord|undefined> {
    const r=await this.pool.query<{
      client_id:string;redirect_uri:string;google_subject:string;identity_email:string|null;
      scope:string;resource:string;pkce_challenge:string
    }>(`DELETE FROM bw_oauth_codes WHERE code_hash=$1 AND expires_at>now()
       RETURNING client_id,redirect_uri,google_subject,identity_email,scope,resource,pkce_challenge`,[hash]);
    const x=r.rows[0];
    return x?{clientId:x.client_id,redirectUri:x.redirect_uri,googleSubject:x.google_subject,
      ...(x.identity_email?{email:x.identity_email}:{}),scope:x.scope,
      resource:x.resource,challenge:x.pkce_challenge}:undefined;
  }
  async saveRefresh(hash:string,record:RefreshRecord):Promise<void> {
    await this.pool.query(`INSERT INTO bw_oauth_refresh
      (token_hash,client_id,google_subject,identity_email,scope,resource,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,now()+interval '30 days')`,
      [hash,record.clientId,record.googleSubject,record.email??null,record.scope,record.resource]);
  }
  async consumeRefresh(hash:string,clientId:string):Promise<RefreshRecord|undefined> {
    // Single-use rotation, serialized by PostgreSQL. Replays fail closed.
    const r=await this.pool.query<{
      client_id:string;google_subject:string;identity_email:string|null;scope:string;resource:string
    }>(`DELETE FROM bw_oauth_refresh WHERE token_hash=$1 AND client_id=$2 AND expires_at>now()
       RETURNING client_id,google_subject,identity_email,scope,resource`,[hash,clientId]);
    const x=r.rows[0];
    return x?{clientId:x.client_id,googleSubject:x.google_subject,
      ...(x.identity_email?{email:x.identity_email}:{}),scope:x.scope,resource:x.resource}:undefined;
  }
}
