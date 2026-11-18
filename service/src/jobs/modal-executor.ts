import { spawn } from 'node:child_process';
import path from 'node:path';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import {parseSceneEdit,type SceneEdit} from './scene-edit.js';
import {parseSceneOperation,isValidInitialSceneOperation,type SceneOperation} from './scene-operation.js';
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
    return this.runRevision(outDir,owner,1);
  }
  async reviseDemo(outDir:string,owner:string,inputBlend:string):Promise<void> {
    if(!path.isAbsolute(inputBlend))throw new RangeError('Revision input must be absolute');
    return this.runRevision(outDir,owner,2,inputBlend);
  }
  async editScene(outDir:string,owner:string,inputBlend:string,revision:number,edit:SceneEdit):Promise<void> {
    if(!path.isAbsolute(inputBlend)||!Number.isInteger(revision)||revision<2||revision>99999999)
      throw new RangeError('Invalid edit input');
    const safe=parseSceneEdit(edit);
    const folder=await mkdtemp(path.join(os.tmpdir(),'bw-edit-'));
    try{
      const editPath=path.join(folder,'edit.json');
      await writeFile(editPath,JSON.stringify(safe),{mode:0o600});
      await this.runRevision(outDir,owner,revision,inputBlend,editPath);
    }finally{await rm(folder,{recursive:true,force:true});}
  }
  async runSceneOperation(outDir:string,owner:string,revision:number,
      operation:SceneOperation,inputBlend?:string):Promise<void>{
    if(!Number.isInteger(revision)||revision<1||revision>99999999||
        (revision===1&&inputBlend!==undefined)||(revision>1&&!inputBlend))
      throw new RangeError('Invalid generic operation revision');
    if(inputBlend&&!path.isAbsolute(inputBlend))throw new RangeError('Invalid source path');
    const safe=parseSceneOperation(operation);
    if(revision===1&&!isValidInitialSceneOperation(safe))
      throw new RangeError('Initial scene must add a primitive');
    const folder=await mkdtemp(path.join(os.tmpdir(),'bw-scene-'));
    try{
      const filepath=path.join(folder,'operation.json');
      await writeFile(filepath,JSON.stringify(safe),{mode:0o600});
      await this.runRevision(outDir,owner,revision,inputBlend,undefined,filepath);
    }finally{await rm(folder,{recursive:true,force:true});}
  }
  private async runRevision(outDir:string,owner:string,revision:number,
      inputBlend?:string,editPath?:string,operationPath?:string):Promise<void> {
    if(!owner?.trim())throw new Error('Missing job owner');
    if(!this.accounts&&!this.legacy)throw new Error('Personal Modal account service unavailable');
    const token=this.accounts?await this.accounts.requireConnected(owner):undefined;
    const env=token?modalJobEnv(token):process.env;
    const script=path.join(this.repoRoot,'modal_provider','runner.py');
    await new Promise<void>((resolve,reject)=>{
      const args=[script,'--out',outDir,'--timeout','900','--cpu','2','--memory-mib','8192',
        '--revision',String(revision)];
      if(inputBlend)args.push('--input-blend',inputBlend);
      if(editPath)args.push('--edit-file',editPath);
      if(operationPath)args.push('--operation-file',operationPath);
      const proc=spawn('python3',args,
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
