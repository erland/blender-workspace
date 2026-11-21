import {JobExecutionError} from './job-diagnostics.js';
import {setTimeout as sleep} from 'node:timers/promises';
import type {JobRepository} from './job-repository.js';
import type {JobOrchestrator} from './orchestrator.js';
import type {RenderJobRepository} from './render-repository.js';
import type {RenderOrchestrator} from './render-orchestrator.js';
import type {GlbPreviewRepository} from './glb-preview-repository.js';
import type {GlbPreviewOrchestrator} from './glb-preview-orchestrator.js';

export interface DispatchOptions {pollMs?:number;graceMinutes?:number;}
export interface DispatchOutcome {state:'idle'|'completed'|'failed';jobId?:string;}
/** Bounded, separate worker process. No Modal execution in the MCP HTTP request.
 * Atomic claiming in PostgreSQL supports independent dispatcher replicas.
 * Ambiguous jobs are quarantined for recovery, not replayed.
 */
export class JobDispatcher {
  readonly pollMs:number;
  readonly graceMinutes:number;
  constructor(private readonly jobs:Pick<JobRepository,'claimNext'|'quarantineStaleRunning'>,
    private readonly workflow:Pick<JobOrchestrator,'executeClaimed'>,
    options:DispatchOptions={},
    private readonly renders?:Pick<RenderJobRepository,'claimNext'|'quarantineStale'>,
    private readonly renderWorkflow?:Pick<RenderOrchestrator,'executeClaimed'>,
    private readonly previews?:Pick<GlbPreviewRepository,'claimNext'|'quarantineStale'>,
    private readonly previewWorkflow?:Pick<GlbPreviewOrchestrator,'executeClaimed'>){
    this.pollMs=options.pollMs??2000;
    this.graceMinutes=options.graceMinutes??30;
    if(!Number.isInteger(this.pollMs)||this.pollMs<250||this.pollMs>60000)
      throw new RangeError('Dispatcher pollMs must be 250-60000');
    if(!Number.isInteger(this.graceMinutes)||this.graceMinutes<20||this.graceMinutes>10080)
      throw new RangeError('Dispatcher graceMinutes must be 20-10080');
  }
  async dispatchOnce():Promise<DispatchOutcome>{
    const job=await this.jobs.claimNext();
    if(!job){
      // Preview refreshes are explicitly queued, low-priority paid jobs.
      const render=this.renders&&this.renderWorkflow?await this.renders.claimNext():null;
      if(!render){
        if(!this.previews||!this.previewWorkflow)return {state:'idle'};
        const preview=await this.previews.claimNext();
        if(!preview)return {state:'idle'};
        try{await this.previewWorkflow.executeClaimed(preview);
          return {state:'completed',jobId:preview.id};
        }catch{console.error(JSON.stringify({event:'glb_preview_failed',jobId:preview.id,
          code:'preview_failed'}));return {state:'failed',jobId:preview.id};}
      }
      try{
        await this.renderWorkflow!.executeClaimed(render);
        return {state:'completed',jobId:render.id};
      }catch{
        console.error(JSON.stringify({event:'render_job_failed',jobId:render.id,
          phase:'render',code:'render_failed'}));
        return {state:'failed',jobId:render.id};
      }
    }
    try{
      await this.workflow.executeClaimed(job);
      return {state:'completed',jobId:job.id};
    }catch(error){
      // Log only allowlisted diagnostics, never provider exception strings or credentials.
      const diagnostic=error instanceof JobExecutionError
        ? {phase:error.phase,code:error.code,...(error.reason?{reason:error.reason}:{})}
        : {phase:'setup',code:'initialization_failed'};
      console.error(JSON.stringify({event:'blender_job_failed',jobId:job.id,...diagnostic}));
      return {state:'failed',jobId:job.id};
    }
  }
  async run(signal:AbortSignal):Promise<void>{
    await this.jobs.quarantineStaleRunning(this.graceMinutes);
    if(this.renders)await this.renders.quarantineStale(this.graceMinutes);
    if(this.previews)await this.previews.quarantineStale(this.graceMinutes);
    while(!signal.aborted){
      const outcome=await this.dispatchOnce();
      if(outcome.state==='idle'){
        await this.jobs.quarantineStaleRunning(this.graceMinutes);
        if(this.renders)await this.renders.quarantineStale(this.graceMinutes);
        if(this.previews)await this.previews.quarantineStale(this.graceMinutes);
        try{await sleep(this.pollMs,undefined,{signal});}
        catch(error){
          if(signal.aborted)return;
          throw error;
        }
      }
    }
  }
}
