import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Job, JobRepository } from './job-repository.js';
import type { IncomingArtifact, LocalArtifactStore } from '../storage/artifact-store.js';
import {parsePythonScript,type PythonScriptSpec} from './python-script.js';
import {JobExecutionError} from './job-diagnostics.js';
import {parseAssetSources} from './asset-sources.js';
import type {UploadedAssets} from './uploaded-assets.js';

export interface BlenderAssetInput {
  path:string;
  format:'blend'|'glb';
  offset:[number,number,number];
}
export interface BlenderExecutor {
  runPythonScript(outDir:string,owner:string,revision:number,spec:PythonScriptSpec,
    inputBlend?:string,assets?:BlenderAssetInput[]):Promise<void>;
}

const SCENE_ARTIFACTS=['scene.blend','scene.json'] as const;
export class JobOrchestrator {
  constructor(private readonly jobs:JobRepository,
              private readonly files:LocalArtifactStore,
              private readonly executor:BlenderExecutor,
              private readonly uploads?:Pick<UploadedAssets,'verifiedPath'>) {}
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
      // The optimistic destination revision remains the latest; the read-only
      // BLEND source may be any older saved revision owned by this project.
      const sourceRevision=job.source_revision??job.expected_revision;
      if(job.expected_revision===0&&sourceRevision!==0 ||
         sourceRevision<0 || sourceRevision>job.expected_revision)
        throw new Error('Invalid source revision');
      const source=sourceRevision===0?undefined:await this.files.verifiedArtifactPath(
        job.project_id,sourceRevision,'scene.blend');
      const requestedAssets=parseAssetSources(job.asset_sources??[]);
      const assets:BlenderAssetInput[]=[];
      if(requestedAssets.length){
        // A project could be deleted after reservation. Fail before billing
        // rather than using orphaned stored files.
        const verified=await this.jobs.validateAssetSources(owner,requestedAssets);
        for(const item of verified){
          if('uploadId' in item){
            if(!this.uploads)throw new Error('Uploaded asset service unavailable');
            const source=await this.uploads.verifiedPath(owner,item.uploadId);
            assets.push({path:source.path,format:source.format,
              offset:item.offset as [number,number,number]});
          }else{
            assets.push({path:await this.files.verifiedArtifactPath(
              item.projectId,item.revision,'scene.blend'),format:'blend',
              offset:item.offset as [number,number,number]});
          }
        }
      }
      await this.executor.runPythonScript(temp,owner,job.requested_revision,spec,source,assets);
      // GLB is a disposable preview, never a prerequisite for the native
      // Blender revision. Only publish one if the trusted worker declared it.
      const artifacts:IncomingArtifact[]=SCENE_ARTIFACTS.map(name=>({
        name,sourcePath:path.join(temp,name)
      }));
      try {
        if((await stat(path.join(temp,'scene.png'))).isFile())
          artifacts.push({name:'scene.png',sourcePath:path.join(temp,'scene.png')});
      }catch(error){
        if((error as NodeJS.ErrnoException).code!=='ENOENT')
          throw new JobExecutionError('artifact_storage','artifact_storage_failed');
      }
      try {
        if((await stat(path.join(temp,'scene.glb'))).isFile())
          artifacts.push({name:'scene.glb',sourcePath:path.join(temp,'scene.glb')});
      }catch(error){
        if((error as NodeJS.ErrnoException).code!=='ENOENT')
          throw new JobExecutionError('artifact_storage','artifact_storage_failed');
      }
      try{
        await this.files.publish({projectId:job.project_id,revision:job.requested_revision,
          expectedPreviousRevision:job.expected_revision,artifacts});
      }catch{
        throw new JobExecutionError('artifact_storage','artifact_storage_failed');
      }
      published=true;
      // Never replay a potentially billed job after publication. The journal
      // and checksum-verified artifacts permit an explicit metadata recovery.
      try{
        return await this.jobs.finalize(owner,jobId,
          `${job.project_id}/${String(job.requested_revision).padStart(8,'0')}`);
      }catch{
        throw new JobExecutionError('revision_commit','revision_commit_failed');
      }
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
