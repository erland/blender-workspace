import { spawn } from 'node:child_process';
import path from 'node:path';
import type { BlenderExecutor } from './orchestrator.js';

/** One-shot, bounded integration with the existing Python Modal worker.
 * Runner root must contain the DEV-002 Blender Docker context. Never accepts
 * arbitrary user-supplied commands or scripts.
 */
export class ModalPythonExecutor implements BlenderExecutor {
  constructor(private readonly repoRoot:string,private readonly timeoutMs=18*60_000) {
    if (!path.isAbsolute(repoRoot))throw new RangeError('Worker root must be absolute');
  }
  async createDemo(outDir:string):Promise<void> {
    const script=path.join(this.repoRoot,'modal_provider','runner.py');
    await new Promise<void>((resolve,reject)=>{
      const proc=spawn('python3',[script,'--out',outDir,'--timeout','900','--cpu','2','--memory-mib','8192'],
        {cwd:this.repoRoot,stdio:['ignore','pipe','pipe'],env:process.env});
      let stderr='',stdout='',ended=false;
      const timer=setTimeout(()=>proc.kill('SIGKILL'),this.timeoutMs);
      proc.stdout.on('data',(part:Buffer)=>{stdout=(stdout+part.toString()).slice(-6000);});
      proc.stderr.on('data',(part:Buffer)=>{stderr=(stderr+part.toString()).slice(-6000);});
      proc.once('error',e=>{if(ended)return;ended=true;clearTimeout(timer);reject(e);});
      proc.once('close',code=>{
        if(ended)return;ended=true;clearTimeout(timer);
        if(code===0)resolve();
        else reject(new Error(`Modal worker exited ${code}; ${stderr.slice(-1000)}`));
      });
    });
  }
}
