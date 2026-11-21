import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type {GlbPreviewJob,GlbPreviewRepository} from './glb-preview-repository.js';
import type {LocalArtifactStore} from '../storage/artifact-store.js';
import type {GlbPreviewArtifactStore} from '../storage/glb-preview-artifacts.js';
import type {ModalGlbPreviewExecutor} from './modal-glb-preview.js';

export class GlbPreviewOrchestrator {
 constructor(private readonly queue:Pick<GlbPreviewRepository,'complete'|'fail'|'get'>,
   private readonly native:Pick<LocalArtifactStore,'verifiedArtifactPath'>,
   private readonly derived:Pick<GlbPreviewArtifactStore,'publish'|'inspectUncommitted'>,
   private readonly executor:Pick<ModalGlbPreviewExecutor,'run'>){}
 async executeClaimed(job:GlbPreviewJob):Promise<void>{
   if(job.status!=='running')throw new Error('Only running preview jobs may execute');
   const dir=await mkdtemp(path.join(os.tmpdir(),'bw-preview-'));
   let published=false;
   try{
     const source=await this.native.verifiedArtifactPath(job.project_id,job.source_revision,'scene.blend');
     await this.executor.run(dir,job.owner_key,source);
     const artifact=await this.derived.publish(job.project_id,job.id,path.join(dir,'preview.glb'));
     published=true;
     await this.queue.complete(job.owner_key,job.id,artifact.sha256,artifact.sizeBytes);
   }catch(error){
     if(!published)await this.queue.fail(job.owner_key,job.id);
     throw error;
   }finally{await rm(dir,{recursive:true,force:true});}
 }
 async recover(owner:string,jobId:string):Promise<boolean>{
   const job=await this.queue.get(owner,jobId);
   if(!job||job.status!=='needs_recovery')return false;
   const artifact=await this.derived.inspectUncommitted(job.project_id,job.id);
   if(!artifact)return false;
   await this.queue.complete(owner,job.id,artifact.sha256,artifact.sizeBytes);
   return true;
 }
}
