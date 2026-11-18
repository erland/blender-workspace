import {setTimeout as sleep} from 'node:timers/promises';
import type {JobRepository} from './job-repository.js';
import type {JobOrchestrator} from './orchestrator.js';

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
    options:DispatchOptions={}){
    this.pollMs=options.pollMs??2000;
    this.graceMinutes=options.graceMinutes??30;
    if(!Number.isInteger(this.pollMs)||this.pollMs<250||this.pollMs>60000)
      throw new RangeError('Dispatcher pollMs must be 250-60000');
    if(!Number.isInteger(this.graceMinutes)||this.graceMinutes<20||this.graceMinutes>10080)
      throw new RangeError('Dispatcher graceMinutes must be 20-10080');
  }
  async dispatchOnce():Promise<DispatchOutcome>{
    const job=await this.jobs.claimNext();
    if(!job)return {state:'idle'};
    try{
      await this.workflow.executeClaimed(job);
      return {state:'completed',jobId:job.id};
    }catch{
      // Orchestrator persists failures / recovery state. Never log credential-bearing exceptions.
      return {state:'failed',jobId:job.id};
    }
  }
  async run(signal:AbortSignal):Promise<void>{
    await this.jobs.quarantineStaleRunning(this.graceMinutes);
    while(!signal.aborted){
      const outcome=await this.dispatchOnce();
      if(outcome.state==='idle'){
        await this.jobs.quarantineStaleRunning(this.graceMinutes);
        try{await sleep(this.pollMs,undefined,{signal});}
        catch(error){
          if(signal.aborted)return;
          throw error;
        }
      }
    }
  }
}
