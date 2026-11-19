import { spawn } from 'node:child_process';
import path from 'node:path';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import type {BlenderExecutor} from './orchestrator.js';
import {parsePythonScript,type PythonScriptSpec} from './python-script.js';
import type {ModalCredentials,ModalAccountManager} from '../modal/modal-accounts.js';

/** Inject only the connected owner's Modal credentials, never global credentials. */
export function modalJobEnv(credentials:ModalCredentials,base:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv {
  const env={...base};
  for(const name of ['MODAL_TOKEN_ID','MODAL_TOKEN_SECRET','MODAL_OAUTH_REFRESH_TOKEN',
    'MODAL_OAUTH_CLIENT_ID','MODAL_OAUTH_CLIENT_SECRET','MODAL_OAUTH_JWT_KEY'])
    delete env[name];
  return {...env,MODAL_TOKEN_ID:credentials.tokenId,MODAL_TOKEN_SECRET:credentials.tokenSecret};
}

/** Launch the trusted controller with a bounded script; bpy runs only in the Sandbox. */
export class ModalPythonExecutor implements BlenderExecutor {
  constructor(private readonly repoRoot:string,private readonly timeoutMs=18*60_000,
    private readonly accounts?:Pick<ModalAccountManager,'requireConnected'>) {
    if(!path.isAbsolute(repoRoot))throw new RangeError('Worker root must be absolute');
  }
  async runPythonScript(outDir:string,owner:string,revision:number,
      spec:PythonScriptSpec,inputBlend?:string):Promise<void> {
    if(!Number.isInteger(revision)||revision<1||revision>99999999||
      (revision===1&&inputBlend!==undefined)||(revision>1&&!inputBlend))
      throw new RangeError('Invalid Python scene revision');
    if(inputBlend&&!path.isAbsolute(inputBlend))
      throw new RangeError('Invalid source path');
    const safe=parsePythonScript(spec);
    if(!owner?.trim())throw new Error('Missing job owner');
    if(!this.accounts)throw new Error('Personal Modal account service unavailable');
    const credentials=await this.accounts.requireConnected(owner);
    const env=modalJobEnv(credentials);
    const folder=await mkdtemp(path.join(os.tmpdir(),'bw-python-'));
    try {
      const filename=path.join(folder,'model.py');
      await writeFile(filename,safe.code,{mode:0o600,flag:'wx'});
      const script=path.join(this.repoRoot,'modal_provider','runner.py');
      await new Promise<void>((resolve,reject)=>{
        const args=[script,'--out',outDir,'--timeout','900','--cpu','2','--memory-mib','8192',
          '--revision',String(revision),'--python-file',filename];
        if(inputBlend)args.push('--input-blend',inputBlend);
        const proc=spawn('python3',args,{cwd:this.repoRoot,stdio:['ignore','pipe','pipe'],env});
        let ended=false;
        const timer=setTimeout(()=>proc.kill('SIGKILL'),this.timeoutMs);
        proc.stdout.on('data',()=>{});
        proc.stderr.on('data',()=>{});
        proc.once('error',error=>{if(ended)return;ended=true;clearTimeout(timer);reject(error);});
        proc.once('close',code=>{
          if(ended)return;ended=true;clearTimeout(timer);
          if(code===0)resolve();
          else reject(new Error(`Modal worker exited ${code}`));
        });
      });
    }finally{await rm(folder,{recursive:true,force:true});}
  }
}
