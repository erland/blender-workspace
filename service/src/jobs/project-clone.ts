import type {ProjectRepository,Project} from '../db/projects.js';
import type {LocalArtifactStore} from '../storage/artifact-store.js';
import {JobConflict} from './job-repository.js';

/** Copy immutable artifacts without Blender execution; publish the new project
 * only after every independently verifiable file has been copied. */
export class ProjectCloneService {
 constructor(private readonly projects:Pick<ProjectRepository,
  'get'|'revisions'|'beginImport'|'finishClone'|'cancelImport'>,
  private readonly artifacts:Pick<LocalArtifactStore,
  'inspect'|'verifiedArtifactPath'|'publish'|'deleteProject'>){}
 async clone(owner:string,sourceProjectId:string,sourceRevision:number,name:string,
  description=''):Promise<Project>{
  if(!Number.isSafeInteger(sourceRevision)||sourceRevision<1||sourceRevision>99999999)
   throw new RangeError('Invalid source revision');
  const source=await this.projects.get(owner,sourceProjectId);
  if(!source)throw new JobConflict('Source project not found');
  const history=await this.projects.revisions(owner,sourceProjectId);
  if(!history.some(r=>r.revision===sourceRevision&&r.artifact_prefix))
   throw new JobConflict('Saved source revision not found');
  const manifest=await this.artifacts.inspect(sourceProjectId,sourceRevision,true);
  if(!manifest.artifacts.some(a=>a.name==='scene.blend'))
   throw new JobConflict('Source has no native Blender scene');
  let id:string|undefined;
  try{
   const destination=await this.projects.beginImport(owner,name,description);
   id=destination.id;
   const sources=[] as {name:string;sourcePath:string}[];
   for(const a of manifest.artifacts)
    sources.push({name:a.name,sourcePath:await this.artifacts.verifiedArtifactPath(
     sourceProjectId,sourceRevision,a.name)});
   const copied=await this.artifacts.publish({projectId:id,revision:1,
    expectedPreviousRevision:0,artifacts:sources});
   if(copied.artifacts.length!==manifest.artifacts.length||
      copied.artifacts.some(a=>{
       const expected=manifest.artifacts.find(x=>x.name===a.name);
       return !expected||expected.sha256!==a.sha256||expected.sizeBytes!==a.sizeBytes;
      }))throw new Error('Cloned artifact checksum mismatch');
   await this.projects.finishClone(owner,id,sourceProjectId,sourceRevision);
   const visible=await this.projects.get(owner,id);
   if(!visible||visible.current_revision!==1)throw new Error('Clone finalize uncertain');
   return visible;
  }catch(error){
   if(id)try{
    // Preserve data on ambiguous COMMIT, like the existing project importer.
    if(!await this.projects.get(owner,id)){
     await this.artifacts.deleteProject(id);
     await this.projects.cancelImport(owner,id);
    }
   }catch{/* Hidden clone can be recovered operationally. */}
   throw error;
  }
 }
}
