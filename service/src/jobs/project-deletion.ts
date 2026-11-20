import type {ProjectRepository} from '../db/projects.js';
import type {LocalArtifactStore} from '../storage/artifact-store.js';

export type DeleteOutcome='deleted'|'busy'|'missing';
/** Two-phase deletion: durable tombstone -> delete bytes -> delete DB records.
 * A storage failure leaves a tombstone for retry rather than orphaning bytes.
 */
export class ProjectDeletionService {
  constructor(private readonly projects:Pick<ProjectRepository,
    'beginPermanentDelete'|'finishPermanentDelete'|'pendingPermanentDeletes'>,
    private readonly artifacts:Pick<LocalArtifactStore,'deleteProject'>){}
  async delete(owner:string,id:string):Promise<DeleteOutcome>{
    const state=await this.projects.beginPermanentDelete(owner,id);
    if(state!=='ready')return state;
    await this.artifacts.deleteProject(id);
    await this.projects.finishPermanentDelete(owner,id);
    return 'deleted';
  }
  /** Restart recovery. A failed pass is observable; no Blender work occurs. */
  async resumePending(max=50):Promise<{processed:number;failed:number}>{
    const items=await this.projects.pendingPermanentDeletes(max);
    let processed=0,failed=0;
    for(const p of items){
      try{
        const result=await this.delete(p.owner_key,p.id);
        if(result==='deleted')processed++;
        else failed++;
      }catch{failed++;}
    }
    return {processed,failed};
  }
}
