import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import type {Pool} from 'pg';

export interface ModalCredentials {tokenId:string;tokenSecret:string;}
export type ModalAccountStatus={connected:boolean;needsRenewal:boolean;updatedAt?:string};
export interface ModalTokenVerifier {verify(credentials:ModalCredentials):Promise<void>;}
export class ModalAccountError extends Error {
  constructor(message:string){super(message);this.name='ModalAccountError';}
}
function principal(owner:string) {
  if(typeof owner!=='string'||!owner.trim()||owner.length>200)throw new ModalAccountError('Invalid owner');
  return owner;
}
function credentials(id:string,secret:string):ModalCredentials {
  if(!id?.trim()||!secret?.trim()||id.length>500||secret.length>1000)
    throw new ModalAccountError('Invalid Modal credentials');
  return {tokenId:id.trim(),tokenSecret:secret.trim()};
}
interface Row {owner_key:string;iv:Buffer;ciphertext:Buffer;auth_tag:Buffer;
 status:'connected'|'revoked';updated_at:Date;}
export class ModalAccountManager {
  constructor(private readonly pool:Pool,private readonly key:Buffer,private readonly verifier:ModalTokenVerifier){
    if(key.length!==32)throw new ModalAccountError('MODAL_CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes');
  }
  static fromBase64(pool:Pool,key:string,verifier:ModalTokenVerifier):ModalAccountManager {
    if(!key||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(key))
      throw new ModalAccountError('Invalid credential encryption key encoding');
    return new ModalAccountManager(pool,Buffer.from(key,'base64'),verifier);
  }
  private async row(owner:string):Promise<Row|undefined>{
    const r=await this.pool.query<Row>('SELECT * FROM bw_modal_accounts WHERE owner_key=$1',[principal(owner)]);
    return r.rows[0];
  }
  async status(owner:string):Promise<ModalAccountStatus>{
    const row=await this.row(owner);
    return row?{connected:row.status==='connected',needsRenewal:row.status==='revoked',
      updatedAt:row.updated_at.toISOString()}:{connected:false,needsRenewal:false};
  }
  async saveAndTest(owner:string,id:string,secret:string):Promise<void>{
    const who=principal(owner),token=credentials(id,secret);
    // Never save credentials unless Modal confirmed them.
    await this.verifier.verify(token);
    const iv=randomBytes(12);
    const cipher=createCipheriv('aes-256-gcm',this.key,iv);
    cipher.setAAD(Buffer.from('bw:modal:'+who));
    const plaintext=Buffer.from(JSON.stringify(token));
    const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
    const tag=cipher.getAuthTag();
    await this.pool.query(`INSERT INTO bw_modal_accounts
      (owner_key,iv,ciphertext,auth_tag,status,updated_at)
      VALUES($1,$2,$3,$4,'connected',now())
      ON CONFLICT(owner_key) DO UPDATE SET iv=excluded.iv,ciphertext=excluded.ciphertext,
        auth_tag=excluded.auth_tag,status='connected',updated_at=now()`,
      [who,iv,ciphertext,tag]);
    plaintext.fill(0);
  }
  async requireConnected(owner:string):Promise<ModalCredentials>{
    const who=principal(owner),row=await this.row(who);
    if(!row||row.status!=='connected')throw new ModalAccountError('Modal account not connected');
    try{
      const decipher=createDecipheriv('aes-256-gcm',this.key,row.iv);
      decipher.setAAD(Buffer.from('bw:modal:'+who));
      decipher.setAuthTag(row.auth_tag);
      const raw=Buffer.concat([decipher.update(row.ciphertext),decipher.final()]);
      const parsed=JSON.parse(raw.toString('utf8')) as ModalCredentials;
      raw.fill(0);
      return credentials(parsed.tokenId,parsed.tokenSecret);
    }catch{throw new ModalAccountError('Stored Modal credentials could not be decrypted');}
  }
  async test(owner:string):Promise<void>{
    const who=principal(owner),token=await this.requireConnected(who);
    try{await this.verifier.verify(token);}
    catch{
      // Authentication failure and transient provider/network errors cannot yet be
      // distinguished reliably. Do not destroy or revoke stored credentials.
      throw new ModalAccountError('Modal connection validation failed');
    }
  }
  async disconnect(owner:string):Promise<void>{
    await this.pool.query('DELETE FROM bw_modal_accounts WHERE owner_key=$1',[principal(owner)]);
  }
}
