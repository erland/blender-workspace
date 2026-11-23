import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Job, JobRepository } from './job-repository.js';
import type { IncomingArtifact, LocalArtifactStore,RevisionResource } from '../storage/artifact-store.js';
import {parsePythonScript,type PythonScriptSpec} from './python-script.js';
import {JobExecutionError} from './job-diagnostics.js';
import {parseAssetSources} from './asset-sources.js';
import type {UploadedAssets} from './uploaded-assets.js';
import type {RenderJobRepository} from './render-repository.js';
import type {RenderArtifactStore} from '../storage/render-artifacts.js';

export interface BlenderAssetInput {
  path:string;
  format:'blend'|'glb'|'png'|'jpg';
  offset:[number,number,number];
  texture?:{objectName:string;channel:'baseColor'|'roughness'|'metallic'|'normal'};
}
export interface RevisionResourceInput extends RevisionResource { path:string; }
export interface BlenderExecutor {
  runPythonScript(outDir:string,owner:string,revision:number,spec:PythonScriptSpec,
    inputBlend?:string,assets?:BlenderAssetInput[],resources?:RevisionResourceInput[]):Promise<void>;
}

const SCENE_ARTIFACTS=['scene.blend','scene.json'] as const;
export class JobOrchestrator {
  constructor(private readonly jobs:JobRepository,
              private readonly files:LocalArtifactStore,
              private readonly executor:BlenderExecutor,
              private readonly uploads?:Pick<UploadedAssets,'verifiedPath'>,
              private readonly renderJobs?:Pick<RenderJobRepository,'registerInline'>,
              private readonly renderFiles?:Pick<RenderArtifactStore,'publish'|'inspectUncommitted'>) {}
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
      const resources:RevisionResourceInput[]=sourceRevision===0?[]:
        await this.files.verifiedRevisionResources(job.project_id,sourceRevision);
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
            if('texture' in item){
              if(!['png','jpg'].includes(source.format))
                throw new Error('Invalid uploaded texture');
              assets.push({path:source.path,format:source.format,offset:[0,0,0],
                texture:item.texture});
            }else{
              if(!['blend','glb'].includes(source.format))
                throw new Error('Invalid uploaded model');
              assets.push({path:source.path,format:source.format,
                offset:item.offset as [number,number,number]});
            }
          }else{
            // Importing a second resource-dependent BLEND requires a
            // per-source namespace/remap, not supported in this phase.
            if((await this.files.verifiedRevisionResources(item.projectId,item.revision)).length)
              throw new Error('External-resource model composition not yet supported');
            assets.push({path:await this.files.verifiedArtifactPath(
              item.projectId,item.revision,'scene.blend'),format:'blend',
              offset:item.offset as [number,number,number]});
          }
        }
      }
      await this.executor.runPythonScript(temp,owner,job.requested_revision,spec,source,assets,resources);
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
        const reportPath=path.join(temp,'scene.json');
        if((await stat(reportPath)).size>16*1024*1024)
          throw new Error('Oversized scene report');
        const report=JSON.parse(await readFile(reportPath,'utf8')) as Record<string,unknown>;
        const declared=report.resourceFiles??[];
        if(!Array.isArray(declared)||declared.length>128)
          throw new Error('Invalid generated resources');
        const resources:RevisionResource[]=[];
        const seen=new Set<string>();
        for(const item of declared){
          if(!item||typeof item!=='object'||Array.isArray(item))
            throw new Error('Invalid generated resource');
          const record=item as Record<string,unknown>;
          if(Object.keys(record).sort().join(',')!=='name,sha256,sizeBytes'||
             typeof record.name!=='string'||typeof record.sha256!=='string'||
             !/^resources\/[0-9a-f]{64}\.(?:png|jpg)$/.test(record.name)||
             seen.has(record.name)||!Number.isSafeInteger(record.sizeBytes))
            throw new Error('Invalid generated resource descriptor');
          seen.add(record.name);
          const file=path.join(temp,record.name);
          const stored=await this.files.storeResource(file);
          if(stored.sha256!==record.sha256||stored.sizeBytes!==record.sizeBytes)
            throw new Error('Generated resource checksum mismatch');
          resources.push({name:record.name,...stored});
        }
        await this.files.publish({projectId:job.project_id,revision:job.requested_revision,
          expectedPreviousRevision:job.expected_revision,artifacts,resources});
      }catch{
        throw new JobExecutionError('artifact_storage','artifact_storage_failed');
      }
      published=true;
      // Never replay a potentially billed job after publication. The journal
      // and checksum-verified artifacts permit an explicit metadata recovery.
      try{
        const committed=await this.jobs.finalize(owner,jobId,
          `${job.project_id}/${String(job.requested_revision).padStart(8,'0')}`);
        // Optional derived preview must never invalidate a committed BLEND.
        await this.registerSavedInlineRender(committed);
        return committed;
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
    if(job.status==='completed'){
      await this.registerSavedInlineRender(job);
      return job;
    }
    if(!['needs_recovery','running'].includes(job.status))
      throw new Error('Job is not recoverable');
    await this.files.inspect(job.project_id,job.requested_revision,true);
    const committed=await this.jobs.finalize(owner,jobId,
      `${job.project_id}/${String(job.requested_revision).padStart(8,'0')}`);
    await this.registerSavedInlineRender(committed);
    return committed;
  }

  /** Copy a verified immutable PNG to the existing render storage, then
   * register a normal completed render. Safe to repeat without Modal billing.
   * Failure cannot roll back or falsely mark the modeling job as failed.
   */
  async registerSavedInlineRender(job:Job):Promise<boolean>{
    if(job.status!=='completed'||!this.renderJobs||!this.renderFiles)return false;
    let spec:PythonScriptSpec;
    try{spec=parsePythonScript(job.operation_spec);}catch{return false;}
    if(!spec.inlineRender)return false;
    let image:string;
    try{
      image=await this.files.verifiedArtifactPath(
        job.project_id,job.requested_revision,'scene.png');
    }catch{return false;} // Rendering was optional and may have failed.
    try{
      let saved=await this.renderFiles.inspectUncommitted(job.project_id,job.id);
      if(!saved)saved=await this.renderFiles.publish(job.project_id,job.id,image);
      await this.renderJobs.registerInline(job.owner_key,job.project_id,
        job.requested_revision,job.id,saved.sha256,saved.sizeBytes);
      return true;
    }catch{
      // Keep the native image for a later, no-Modal reconciliation.
      return false;
    }
  }
}
