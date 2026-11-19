import { spawn } from 'node:child_process';
import path from 'node:path';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import type {BlenderExecutor} from './orchestrator.js';
import {parsePythonScript,type PythonScriptSpec} from './python-script.js';
import type {ModalCredentials,ModalAccountManager} from '../modal/modal-accounts.js';
import {JobExecutionError,parseRunnerDiagnostic} from './job-diagnostics.js';

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
        let ended=false,timedOut=false;
        let stdout='',stderr='';
        // Keep only the last 8 KiB of each stream. Never log or persist raw output:
        // scripts, Modal SDK exceptions and paths may contain sensitive content.
        const append=(old:string,chunk:Buffer)=> (old+chunk.toString('utf8')).slice(-8192);
        const timer=setTimeout(()=>{timedOut=true;proc.kill('SIGKILL');},this.timeoutMs);
        proc.stdout.on('data',(chunk:Buffer)=>{stdout=append(stdout,chunk);});
        proc.stderr.on('data',(chunk:Buffer)=>{stderr=append(stderr,chunk);});
        proc.once('error',()=>{if(ended)return;ended=true;clearTimeout(timer);
          reject(new JobExecutionError('setup','worker_spawn_failed'));});
        proc.once('close',code=>{
          if(ended)return;ended=true;clearTimeout(timer);
          if(timedOut)return reject(new JobExecutionError('setup','worker_timeout'));
          if(code===0)return resolve();
          // Only the validated runner marker is used, never free-form output.
          reject(parseRunnerDiagnostic(stderr)||parseRunnerDiagnostic(stdout)||
            new JobExecutionError('setup','worker_exit_nonzero'));
        });
      });
    }finally{await rm(folder,{recursive:true,force:true});}
  }
}
