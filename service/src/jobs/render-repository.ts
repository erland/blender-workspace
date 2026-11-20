import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {validateViewerCamera,type ViewerCamera} from './viewer-camera.js';

export type RenderEngine='BLENDER_EEVEE_NEXT'|'CYCLES';
export interface RenderOptions {engine:RenderEngine;width:number;height:number;samples:number;requestedFrom?:'viewer'|'project';camera?:ViewerCamera;}
export interface RenderJob {
 id:string;project_id:string;owner_key:string;source_revision:number;engine:RenderEngine;
 width:number;height:number;samples:number;requested_from:'viewer'|'project';camera_override:ViewerCamera|null;status:'pending'|'running'|'needs_recovery'|'completed'|'failed';
 error_code:string|null;sha256:string|null;size_bytes:number|null;created_at:Date;
}
export function validateRenderOptions(value:RenderOptions):RenderOptions {
 if(!value||!['BLENDER_EEVEE_NEXT','CYCLES'].includes(value.engine)||
   !Number.isInteger(value.width)||!Number.isInteger(value.height)||
   !Number.isInteger(value.samples)||![8,16,32].includes(value.samples))
   throw new RangeError('Invalid bounded render options');
 if(value.requestedFrom===undefined||value.requestedFrom==='project'){
   if(value.camera!==undefined||![256,512,1024].includes(value.width)||
      ![256,512,1024].includes(value.height))throw new RangeError('Invalid project render');
 }else if(value.requestedFrom==='viewer'){
   if(value.engine!=='CYCLES'||value.samples!==16||!value.camera||
     Math.min(value.width,value.height)!==512||Math.max(value.width,value.height)>2048)
     throw new RangeError('Invalid viewer render');
   validateViewerCamera(value.camera);
 }else throw new RangeError('Invalid render source');
 return value;
}
export class RenderJobRepository {
 constructor(private readonly pool:Pool){}
 async reserve(owner:string,projectId:string,revision:number,options:RenderOptions):Promise<RenderJob>{
   validateRenderOptions(options);
   if(!owner.trim()||owner.length>200||!Number.isSafeInteger(revision)||revision<1)
     throw new RangeError('Invalid render request');
   const c=await this.pool.connect();
   try{
     await c.query('BEGIN');
     const exists=await c.query(
       `SELECT r.revision FROM bw_project_revisions r JOIN bw_projects p ON p.id=r.project_id
         WHERE p.id=$1 AND p.owner_key=$2 AND p.deleted_at IS NULL
         AND r.revision=$3 AND r.artifact_prefix IS NOT NULL FOR UPDATE OF p`,
       [projectId,owner,revision]);
     if(!exists.rowCount)throw new RangeError('Saved revision unavailable');
     const inserted=await c.query<RenderJob>(
       `INSERT INTO bw_render_jobs
       (id,project_id,owner_key,source_revision,engine,width,height,samples,status,requested_from,camera_override)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10::jsonb) RETURNING *`,
       [randomUUID(),projectId,owner,revision,options.engine,options.width,options.height,options.samples,
        options.requestedFrom??'project',options.camera?JSON.stringify(options.camera):null]);
     await c.query('COMMIT');
     return inserted.rows[0];
   }catch(e){
     await c.query('ROLLBACK');
     if((e as {code?:string}).code==='23505')throw new RangeError('Another render is active');
     throw e;
   }finally{c.release();}
 }
 async list(owner:string,projectId:string,revision?:number):Promise<RenderJob[]>{
   return (await this.pool.query<RenderJob>(
     `SELECT j.* FROM bw_render_jobs j JOIN bw_projects p ON p.id=j.project_id
      WHERE j.project_id=$1 AND j.owner_key=$2 AND p.owner_key=$2
      AND p.deleted_at IS NULL AND ($3::integer IS NULL OR j.source_revision=$3)
      ORDER BY j.created_at DESC,j.id DESC LIMIT 50`,
     [projectId,owner,revision??null])).rows;
 }
 /** Recent render jobs across all owned, non-deleted projects. */
 async listForOwner(owner:string,limit=50):Promise<RenderJob[]>{
   if(!owner.trim()||owner.length>200||!Number.isInteger(limit)||limit<1||limit>100)
     throw new RangeError('Invalid render history request');
   return (await this.pool.query<RenderJob>(
     `SELECT j.* FROM bw_render_jobs j JOIN bw_projects p ON p.id=j.project_id
      WHERE j.owner_key=$1 AND p.owner_key=$1 AND p.deleted_at IS NULL
      ORDER BY j.created_at DESC,j.id DESC LIMIT $2`,
     [owner,limit])).rows;
 }
 /** One bounded query for the latest saved images of every project card.
  * Owner scope and deletion visibility are enforced by the JOIN. */
 async recentCompletedByProjects(owner:string,projectIds:string[],perProject=3):Promise<RenderJob[]>{
   if(!owner.trim()||owner.length>200||!Number.isInteger(perProject)||perProject<1||perProject>3||
      projectIds.length>100||projectIds.some(id=>!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))
     throw new RangeError('Invalid gallery request');
   if(projectIds.length===0)return [];
   return (await this.pool.query<RenderJob>(
     `SELECT recent.* FROM (
        SELECT j.*,ROW_NUMBER() OVER (PARTITION BY j.project_id
          ORDER BY j.created_at DESC,j.id DESC) AS gallery_rank
        FROM bw_render_jobs j
        JOIN bw_projects p ON p.id=j.project_id
        WHERE p.owner_key=$1 AND j.owner_key=$1 AND p.deleted_at IS NULL
          AND j.project_id=ANY($2::uuid[]) AND j.status='completed'
          AND j.sha256 IS NOT NULL AND j.size_bytes IS NOT NULL
      ) recent WHERE gallery_rank<=$3
      ORDER BY recent.project_id,recent.gallery_rank`,[owner,projectIds,perProject])).rows;
 }
 async get(owner:string,id:string):Promise<RenderJob|null>{
   return (await this.pool.query<RenderJob>(
     `SELECT j.* FROM bw_render_jobs j JOIN bw_projects p ON p.id=j.project_id
      WHERE j.id=$1 AND j.owner_key=$2 AND p.owner_key=$2 AND p.deleted_at IS NULL`,
     [id,owner])).rows[0]??null;
 }
 async claimNext():Promise<RenderJob|null>{
   return (await this.pool.query<RenderJob>(
     `WITH next AS (
       SELECT j.id FROM bw_render_jobs j
       JOIN bw_projects p ON p.id=j.project_id
       JOIN bw_modal_accounts a ON a.owner_key=j.owner_key AND a.status='connected'
       WHERE j.status='pending' AND p.owner_key=j.owner_key AND p.deleted_at IS NULL
       ORDER BY j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1)
       UPDATE bw_render_jobs j SET status='running',updated_at=now()
       FROM next WHERE j.id=next.id AND j.status='pending' RETURNING j.*`)).rows[0]??null;
 }
 async complete(owner:string,id:string,digest:string,bytes:number):Promise<void>{
   if(!/^[0-9a-f]{64}$/.test(digest)||!Number.isSafeInteger(bytes)||bytes<1||bytes>16*1024*1024)
      throw new RangeError('Invalid render artifact');
   const r=await this.pool.query(
     `UPDATE bw_render_jobs SET status='completed',sha256=$3,size_bytes=$4,
       error_code=NULL,updated_at=now(),finished_at=now()
       WHERE id=$1 AND owner_key=$2 AND status IN ('running','needs_recovery') RETURNING id`,
     [id,owner,digest,bytes]);
   if(!r.rowCount)throw new Error('Render finalization unavailable');
 }
 async fail(owner:string,id:string,code='render_failed'):Promise<void>{
   const safe=['render_failed','source_invalid','worker_unavailable','render_timeout','artifact_invalid'].includes(code)
     ?code:'render_failed';
   await this.pool.query(
     `UPDATE bw_render_jobs SET status='failed',error_code=$3,updated_at=now(),finished_at=now()
       WHERE id=$1 AND owner_key=$2 AND status='running'`,[id,owner,safe]);
 }
 async quarantineStale(minMinutes=30):Promise<number>{
   const r=await this.pool.query(
     `UPDATE bw_render_jobs SET status='needs_recovery',error_code='worker_unavailable',updated_at=now()
       WHERE status='running' AND updated_at<now()-($1::integer * interval '1 minute') RETURNING id`,
     [minMinutes]);return r.rowCount??0;
 }
}
