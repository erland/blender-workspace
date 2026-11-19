import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Job, JobRepository } from './job-repository.js';
import type { IncomingArtifact, LocalArtifactStore } from '../storage/artifact-store.js';
import {parsePythonScript,type PythonScriptSpec} from './python-script.js';

export interface BlenderExecutor {
  runPythonScript(outDir:string,owner:string,revision:number,spec:PythonScriptSpec,inputBlend?:string):Promise<void>;
}

const SCENE_ARTIFACTS=['scene.blend','scene.glb','scene.json'] as const;
export class JobOrchestrator {
  constructor(private readonly jobs:JobRepository,
              private readonly files:LocalArtifactStore,
              private readonly executor:BlenderExecutor) {}
  async execute(owner:string,jobId:string):Promise<Job> {
    const job=await this.jobs.claim(owner,jobId);
    return this.executeClaimed(job);
  }
  /** Only Python jobs can publish a scene; unrecognized historical jobs fail closed. */
  async executeClaimed(job:Job):Promise<Job> {
    if(job.status!=='running')throw new Error('Only running jobs can execute');
    const owner=job.owner_key,jobId=job.id;
    const temp=await mkdtemp(path.join(os.tmpdir(),'bw-job-'));
    let published=false;
    try {
      if(job.edit_spec!==null && job.edit_spec!==undefined)
        throw new Error('Retired structured edit job is not executable');
      const spec=parsePythonScript(job.operation_spec);
      const source=job.expected_revision===0?undefined:await this.files.verifiedArtifactPath(
        job.project_id,job.expected_revision,'scene.blend');
      await this.executor.runPythonScript(temp,owner,job.requested_revision,spec,source);
      const artifacts:IncomingArtifact[]=SCENE_ARTIFACTS.map(name=>({
        name,sourcePath:path.join(temp,name)
      }));
      await this.files.publish({projectId:job.project_id,revision:job.requested_revision,
        expectedPreviousRevision:job.expected_revision,artifacts});
      published=true;
      // Never replay a potentially billed job after publication. The journal
      // and checksum-verified artifacts permit an explicit metadata recovery.
      return await this.jobs.finalize(owner,jobId,
        `${job.project_id}/${String(job.requested_revision).padStart(8,'0')}`);
    }catch(error) {
      if(published)await this.jobs.markRecoverable(owner,jobId,error);
      else await this.jobs.markFailed(owner,jobId,error);
      throw error;
    }finally{await rm(temp,{recursive:true,force:true});}
  }
  /** Reconcile an already published immutable revision; never rerun Blender. */
  async recover(owner:string,jobId:string):Promise<Job> {
    const job=await this.jobs.get(owner,jobId);
    if(!job)throw new Error('Job not found');
    if(job.status==='completed')return job;
    if(!['needs_recovery','running'].includes(job.status))
      throw new Error('Job is not recoverable');
    await this.files.inspect(job.project_id,job.requested_revision,true);
    return this.jobs.finalize(owner,jobId,
      `${job.project_id}/${String(job.requested_revision).padStart(8,'0')}`);
  }
}
