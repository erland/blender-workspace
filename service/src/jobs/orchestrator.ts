import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Job, JobRepository } from './job-repository.js';
import type { IncomingArtifact, LocalArtifactStore } from '../storage/artifact-store.js';
import {parseSceneEdit,type SceneEdit} from './scene-edit.js';
import {parseSceneOperation,type SceneOperation} from './scene-operation.js';

export interface BlenderExecutor {
  /** Produce trusted outputs for the current demo. DEV-006 only creates revision 1. */
  createDemo(outDir:string,owner:string):Promise<void>;
  reviseDemo?(outDir:string,owner:string,inputBlend:string):Promise<void>;
  editScene?(outDir:string,owner:string,inputBlend:string,revision:number,edit:SceneEdit):Promise<void>;
  runSceneOperation?(outDir:string,owner:string,revision:number,operation:SceneOperation,inputBlend?:string):Promise<void>;
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
    if(job.expected_revision>0 && !job.edit_spec && !job.operation_spec && job.expected_revision!==1) {
      await this.jobs.markFailed(owner,jobId,'A structured edit is required for this revision');
      throw new Error('A structured edit is required for this revision');
    }
    const temp=await mkdtemp(path.join(os.tmpdir(),'bw-job-'));
    let published=false;
    try {
      if(job.operation_spec){
        if(!this.executor.runSceneOperation)throw new Error('Generic operation executor is not configured');
        const operation=parseSceneOperation(job.operation_spec);
        const source=job.expected_revision===0?undefined:await this.files.verifiedArtifactPath(
          job.project_id,job.expected_revision,'scene.blend');
        await this.executor.runSceneOperation(temp,owner,job.requested_revision,operation,source);
      }else if(job.expected_revision===0){
        await this.executor.createDemo(temp,job.owner_key);
      }else{
        // Each edit is based on the most recent SHA-verified immutable predecessor.
        const previous=job.expected_revision;
        const input=await this.files.verifiedArtifactPath(job.project_id,previous,
          `monster_v${previous}.blend`);
        if(job.edit_spec){
          if(!this.executor.editScene)throw new Error('Structured edit executor is not configured');
          await this.executor.editScene(temp,owner,input,job.requested_revision,
            parseSceneEdit(job.edit_spec));
        }else{
          // Compatibility: the existing predefined blue v1 -> v2 operation.
          if(!this.executor.reviseDemo)throw new Error('Revision executor is not configured');
          await this.executor.reviseDemo(temp,owner,input);
        }
      }
      const names=job.operation_spec?['scene.blend','scene.glb','scene.json']:artifactFiles(job.requested_revision);
      const artifacts:IncomingArtifact[]=names
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
