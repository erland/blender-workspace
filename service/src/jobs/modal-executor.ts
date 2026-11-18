import { spawn } from 'node:child_process';
import path from 'node:path';
import type {BlenderExecutor} from './orchestrator.js';
import type {ModalCredentials,ModalAccountManager} from '../modal/modal-accounts.js';

/** Per-job env is isolated: no inherited global Modal credentials can override the user's account. */
export function modalJobEnv(credentials:ModalCredentials,base:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv {
  const env={...base};
  for(const name of ['MODAL_TOKEN_ID','MODAL_TOKEN_SECRET','MODAL_OAUTH_REFRESH_TOKEN',
    'MODAL_OAUTH_CLIENT_ID','MODAL_OAUTH_CLIENT_SECRET','MODAL_OAUTH_JWT_KEY'])
    delete env[name];
  return {...env,MODAL_TOKEN_ID:credentials.tokenId,MODAL_TOKEN_SECRET:credentials.tokenSecret};
}


/** One-shot, bounded integration with the existing Python Modal worker.
 * Runner root must contain the DEV-002 Blender Docker context. Never accepts
 * arbitrary user-supplied commands or scripts.
 */
export class ModalPythonExecutor implements BlenderExecutor {
  constructor(private readonly repoRoot:string,private readonly timeoutMs=18*60_000,
    private readonly accounts?: Pick<ModalAccountManager,'requireConnected'>,private readonly legacy=false) {
    if (!path.isAbsolute(repoRoot))throw new RangeError('Worker root must be absolute');
  }
  async createDemo(outDir:string,owner:string):Promise<void> {
    if(!owner?.trim())throw new Error('Missing job owner');
    if(!this.accounts&&!this.legacy)throw new Error('Personal Modal account service unavailable');
    const token=this.accounts?await this.accounts.requireConnected(owner):undefined;
    const env=token?modalJobEnv(token):process.env;
    const script=path.join(this.repoRoot,'modal_provider','runner.py');
    await new Promise<void>((resolve,reject)=>{
      const proc=spawn('python3',[script,'--out',outDir,'--timeout','900','--cpu','2','--memory-mib','8192'],
        {cwd:this.repoRoot,stdio:['ignore','pipe','pipe'],env});
      let ended=false;
      const timer=setTimeout(()=>proc.kill('SIGKILL'),this.timeoutMs);
      proc.stdout.on('data',()=>{});
      proc.stderr.on('data',()=>{});
      proc.once('error',e=>{if(ended)return;ended=true;clearTimeout(timer);reject(e);});
      proc.once('close',code=>{
        if(ended)return;ended=true;clearTimeout(timer);
        if(code===0)resolve();
        else reject(new Error(`Modal worker exited ${code}`));
      });
    });
  }
}
