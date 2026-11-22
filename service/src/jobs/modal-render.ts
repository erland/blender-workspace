import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {validateModalMemoryMiB,type ModalAccountManager} from '../modal/modal-accounts.js';
import {modalJobEnv} from './modal-executor.js';
import type {RenderOptions} from './render-repository.js';

/** Never executes supplied Python; invokes only fixed trusted controller commands. */
export class ModalRenderExecutor {
 constructor(private readonly root:string,
   private readonly accounts:Pick<ModalAccountManager,'requireConnected'|'memoryMiB'>,
   private readonly timeoutMs=7*60_000){
   if(!path.isAbsolute(root))throw new RangeError('Absolute worker root required');
 }
 async run(outDir:string,owner:string,source:string,options:RenderOptions):Promise<void>{
   const credentials=await this.accounts.requireConnected(owner);
   const memoryMiB=validateModalMemoryMiB(await this.accounts.memoryMiB(owner));
   const env=modalJobEnv(credentials);
   const script=path.join(this.root,'modal_provider','render_runner.py');
   await new Promise<void>((resolve,reject)=>{
     const args=[script,'--out',outDir,'--input-blend',source,'--engine',options.engine,
       '--width',String(options.width),'--height',String(options.height),
       '--samples',String(options.samples),'--memory-mib',String(memoryMiB),
       ...(options.camera?['--camera-json',JSON.stringify(options.camera)]:[])];
     const proc=spawn('python3',args,{cwd:this.root,env,stdio:['ignore','ignore','pipe']});
     let finished=false,timedOut=false;
     let diagnostic='';
     proc.stderr.on('data',(data:Buffer)=>{
       diagnostic=(diagnostic+data.toString('utf8')).slice(-1000);
     });
     const timer=setTimeout(()=>{timedOut=true;proc.kill('SIGKILL');},this.timeoutMs);
     proc.once('error',()=>{if(finished)return;finished=true;clearTimeout(timer);
       reject(new Error('Render worker could not start'));});
     proc.once('close',code=>{if(finished)return;finished=true;clearTimeout(timer);
       if(timedOut)return reject(new Error('Render worker timed out'));
       if(code!==0)return reject(new Error('Render worker failed'));
       resolve();
     });
   });
 }
}
