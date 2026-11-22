import {spawn} from 'node:child_process';
import path from 'node:path';
import {validateModalMemoryMiB,type ModalAccountManager} from '../modal/modal-accounts.js';
import {modalJobEnv} from './modal-executor.js';

export class ModalGlbPreviewExecutor {
 constructor(private readonly root:string,
   private readonly accounts:Pick<ModalAccountManager,'requireConnected'|'memoryMiB'>,
   private readonly timeoutMs=7*60_000){
   if(!path.isAbsolute(root))throw new RangeError('Absolute worker root required');
 }
 async run(outDir:string,owner:string,source:string):Promise<void>{
   const credentials=await this.accounts.requireConnected(owner);
   const memoryMiB=validateModalMemoryMiB(await this.accounts.memoryMiB(owner));
   const env=modalJobEnv(credentials);
   await new Promise<void>((resolve,reject)=>{
     const proc=spawn('python3',[path.join(this.root,'modal_provider','glb_preview_runner.py'),
       '--out',outDir,'--input-blend',source,'--memory-mib',String(memoryMiB)],{cwd:this.root,env,
       stdio:['ignore','ignore','pipe']});
     let done=false;
     const timer=setTimeout(()=>{proc.kill('SIGKILL');finish(new Error('Preview worker timed out'));},
       this.timeoutMs);
     function finish(error?:Error){
       if(done)return;done=true;clearTimeout(timer);
       if(error)reject(error);else resolve();
     }
     proc.stderr.on('data',()=>{}); // Do not echo remote Python or credentials
     proc.once('error',()=>finish(new Error('Preview worker unavailable')));
     proc.once('close',code=>finish(code===0?undefined:new Error('Preview worker failed')));
   });
 }
}
