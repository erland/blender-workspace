import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Job, JobRepository } from './job-repository.js';
import type { IncomingArtifact, LocalArtifactStore } from '../storage/artifact-store.js';

export interface BlenderExecutor {
  /** Produce trusted outputs for the current demo. DEV-006 only creates revision 1. */
  createDemo(outDir:string,owner:string):Promise<void>;
}
const FILES=['monster_v1.blend','monster_v1.glb','monster_v1.json'] as const;
export class JobOrchestrator {
  constructor(private readonly jobs:JobRepository,
              private readonly files:LocalArtifactStore,
              private readonly executor:BlenderExecutor) {}
  async createDemo(owner:string,projectId:string,note='Automated cube monster'):Promise<Job> {
    const job=await this.jobs.reserve(owner,projectId,0,note);
    return this.execute(owner,job.id);
  }
  async execute(owner:string,jobId:string):Promise<Job> {
    const job=await this.jobs.claim(owner,jobId);
    return this.executeClaimed(job);
  }
  /** A claimed row is supplied by JobRepository.claimNext (or claim). */
  async executeClaimed(job:Job):Promise<Job> {
    if(job.status!=='running')throw new Error('Only running jobs can execute');
    const owner=job.owner_key,jobId=job.id;
    // Existing project modifications are not supported by the DEV-002 Modal runner yet.
    if(job.expected_revision!==0) {
      await this.jobs.markFailed(owner,jobId,'Only initial demo generation is supported');
      throw new Error('Only initial demo generation is supported');
    }
    const temp=await mkdtemp(path.join(os.tmpdir(),'bw-job-'));
    let published=false;
    try {
      await this.executor.createDemo(temp,job.owner_key);
      const artifacts:IncomingArtifact[]=FILES.map(name=>({name,sourcePath:path.join(temp,name)}));
      await this.files.publish({projectId:job.project_id,revision:job.requested_revision,
        expectedPreviousRevision:job.expected_revision,artifacts});
      published=true;
      // Postgres commit can fail after filesystem atomic publish. The active
      // journal row and immutable files enable an explicit recovery operation.
      return await this.jobs.finalize(owner,jobId,
        `${job.project_id}/${String(job.requested_revision).padStart(8,'0')}`);
    }catch(error) {
      if(published) await this.jobs.markRecoverable(owner,jobId,error);
      else await this.jobs.markFailed(owner,jobId,error);
      throw error;
    }finally{await rm(temp,{recursive:true,force:true});}
  }
  /** Reconcile a job with an already published artifact revision; never rerun Blender. */
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
