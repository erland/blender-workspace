import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';

export type RenderEngine='BLENDER_EEVEE_NEXT'|'CYCLES';
export interface RenderOptions {engine:RenderEngine;width:number;height:number;samples:number;}
export interface RenderJob {
 id:string;project_id:string;owner_key:string;source_revision:number;engine:RenderEngine;
 width:number;height:number;samples:number;status:'pending'|'running'|'needs_recovery'|'completed'|'failed';
 error_code:string|null;sha256:string|null;size_bytes:number|null;created_at:Date;
}
export function validateRenderOptions(value:RenderOptions):RenderOptions {
 if(!value||!['BLENDER_EEVEE_NEXT','CYCLES'].includes(value.engine) ||
   !Number.isInteger(value.width)||![256,512,1024].includes(value.width) ||
   !Number.isInteger(value.height)||![256,512,1024].includes(value.height) ||
   !Number.isInteger(value.samples)||![8,16,32].includes(value.samples))
   throw new RangeError('Invalid bounded render options');
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
       (id,project_id,owner_key,source_revision,engine,width,height,samples,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending') RETURNING *`,
       [randomUUID(),projectId,owner,revision,options.engine,options.width,options.height,options.samples]);
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
