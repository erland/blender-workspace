import {ModalClient} from 'modal';
import type {ModalCredentials,ModalTokenVerifier} from './modal-accounts.js';

/** Verify credentials with Modal's official JS SDK. No Python/Modal CLI dependency in MCP service.
 * The client is explicitly configured per account; no process-global credential lookup.
 */
export class ModalCliTokenVerifier implements ModalTokenVerifier {
  constructor(private readonly timeoutMs=15_000) {}
  async verify(token:ModalCredentials):Promise<void>{
    const client=new ModalClient({
      tokenId:token.tokenId,tokenSecret:token.tokenSecret,timeoutMs:this.timeoutMs,maxRetries:0
    });
    try{
      // Authenticated, read-only API call. No sandbox creation or billing job.
      await client.getImageBuilderVersion();
    }catch{
      throw new Error('Modal credential verification failed');
    }finally{
      client.close();
    }
  }
}
