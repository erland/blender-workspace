import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type {RenderJob,RenderJobRepository} from './render-repository.js';
import type {LocalArtifactStore} from '../storage/artifact-store.js';
import type {RenderArtifactStore} from '../storage/render-artifacts.js';
import type {ModalRenderExecutor} from './modal-render.js';

export class RenderOrchestrator {
 constructor(private readonly queue:Pick<RenderJobRepository,'complete'|'fail'|'get'>,
   private readonly native:Pick<LocalArtifactStore,'verifiedArtifactPath'>,
   private readonly previews:Pick<RenderArtifactStore,'publish'|'inspectUncommitted'>,
   private readonly executor:Pick<ModalRenderExecutor,'run'>){}
 async executeClaimed(job:RenderJob):Promise<void>{
   if(job.status!=='running')throw new Error('Only claimed renders may run');
   const dir=await mkdtemp(path.join(os.tmpdir(),'bw-render-'));
   let published=false;
   try{
     const source=await this.native.verifiedArtifactPath(job.project_id,job.source_revision,'scene.blend');
     await this.executor.run(dir,job.owner_key,source,{
       engine:job.engine,width:job.width,height:job.height,samples:job.samples});
     const saved=await this.previews.publish(job.project_id,job.id,path.join(dir,'render.png'));
     published=true;
     await this.queue.complete(job.owner_key,job.id,saved.sha256,saved.sizeBytes);
   }catch(error){
     // A committed PNG followed by a database outage must not trigger another
     // billable render. Leave job running for stale quarantine and manual recovery.
     if(!published){
       await this.queue.fail(job.owner_key,job.id,'render_failed');
     }
     throw error;
   }finally{await rm(dir,{recursive:true,force:true});}
 }
 async recover(owner:string,jobId:string):Promise<boolean>{
   const job=await this.queue.get(owner,jobId);
   if(!job||job.status!=='needs_recovery')return false;
   const saved=await this.previews.inspectUncommitted(job.project_id,job.id);
   if(!saved)return false;
   await this.queue.complete(owner,job.id,saved.sha256,saved.sizeBytes);
   return true;
 }
}
