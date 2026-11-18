import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Job, JobRepository } from './job-repository.js';
import type { IncomingArtifact, LocalArtifactStore } from '../storage/artifact-store.js';

export interface BlenderExecutor {
  /** Produce trusted outputs for the current demo. DEV-006 only creates revision 1. */
  createDemo(outDir:string,owner:string):Promise<void>;
  reviseDemo?(outDir:string,owner:string,inputBlend:string):Promise<void>;
}
const artifactFiles=(revision:number)=>['blend','glb','json'].map(ext=>`monster_v${revision}.${ext}`);
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
    // Currently supported transformations: initial creation and a controlled
    // blue recolor of the previous .blend scene. No arbitrary Blender scripts.
    if(job.expected_revision>1) {
      await this.jobs.markFailed(owner,jobId,'Only revisions 1 and 2 are supported');
      throw new Error('Only revisions 1 and 2 are supported');
    }
    const temp=await mkdtemp(path.join(os.tmpdir(),'bw-job-'));
    let published=false;
    try {
      if(job.expected_revision===0){
        await this.executor.createDemo(temp,job.owner_key);
      }else{
        if(!this.executor.reviseDemo)throw new Error('Revision executor is not configured');
        // Validate manifest bytes and hashes before copying the input to Modal.
        // Ownership is guaranteed by the claimed, owner-scoped database job.
        const input=await this.files.verifiedArtifactPath(job.project_id,1,'monster_v1.blend');
        await this.executor.reviseDemo(temp,job.owner_key,input);
      }
      const artifacts:IncomingArtifact[]=artifactFiles(job.requested_revision)
        .map(name=>({name,sourcePath:path.join(temp,name)}));
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
