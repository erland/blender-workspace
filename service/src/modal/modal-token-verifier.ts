import {spawn} from 'node:child_process';
import type {ModalCredentials,ModalTokenVerifier} from './modal-accounts.js';

/** Calls the Modal CLI with an isolated credential environment. Never logs the secret. */
export class ModalCliTokenVerifier implements ModalTokenVerifier {
  constructor(private readonly timeoutMs=30_000) {}
  async verify(token:ModalCredentials):Promise<void>{
    await new Promise<void>((resolve,reject)=>{
      const env:NodeJS.ProcessEnv={...process.env,MODAL_TOKEN_ID:token.tokenId,MODAL_TOKEN_SECRET:token.tokenSecret};
      delete env.MODAL_OAUTH_REFRESH_TOKEN;
      delete env.MODAL_OAUTH_CLIENT_ID;
      delete env.MODAL_OAUTH_CLIENT_SECRET;
      delete env.MODAL_OAUTH_JWT_KEY;
      const proc=spawn('modal',['token','info'],{env,stdio:'ignore'});
      let finished=false;
      const timer=setTimeout(()=>proc.kill('SIGKILL'),this.timeoutMs);
      proc.once('error',()=>{if(!finished){finished=true;clearTimeout(timer);
        reject(new Error('Modal credential verification unavailable'));}});
      proc.once('close',code=>{if(!finished){finished=true;clearTimeout(timer);
        code===0?resolve():reject(new Error('Modal credential verification rejected'));}});
    });
  }
}
