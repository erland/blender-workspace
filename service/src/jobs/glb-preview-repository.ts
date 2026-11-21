import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';

export interface GlbPreviewJob {
 id:string;project_id:string;owner_key:string;source_revision:number;
 status:'pending'|'running'|'needs_recovery'|'completed'|'failed';
 error_code:string|null;sha256:string|null;size_bytes:number|null;created_at:Date;
}
export class GlbPreviewRepository {
 constructor(private readonly pool:Pool){}
 async reserve(owner:string,projectId:string,revision:number):Promise<GlbPreviewJob>{
   if(!owner||owner.length>200||!Number.isSafeInteger(revision)||revision<1)
     throw new RangeError('Invalid GLB refresh request');
   const db=await this.pool.connect();
   try{
     await db.query('BEGIN');
     const source=await db.query(
       `SELECT r.revision FROM bw_project_revisions r
        JOIN bw_projects p ON p.id=r.project_id
        WHERE r.project_id=$1 AND r.revision=$3 AND r.artifact_prefix IS NOT NULL
          AND p.owner_key=$2 AND p.deleted_at IS NULL FOR UPDATE OF p`,
       [projectId,owner,revision]);
     if(!source.rowCount)throw new RangeError('Saved revision not found');
     const result=await db.query<GlbPreviewJob>(
       `INSERT INTO bw_glb_preview_jobs(id,project_id,owner_key,source_revision)
        VALUES ($1,$2,$3,$4) RETURNING *`,
       [randomUUID(),projectId,owner,revision]);
     await db.query('COMMIT');
     return result.rows[0];
   }catch(error){
     await db.query('ROLLBACK');
     if((error as {code?:string}).code==='23505')
       throw new RangeError('A GLB refresh is already active for this revision');
     throw error;
   }finally{db.release();}
 }
 async get(owner:string,id:string):Promise<GlbPreviewJob|null>{
   return (await this.pool.query<GlbPreviewJob>(
     `SELECT j.* FROM bw_glb_preview_jobs j
      JOIN bw_projects p ON p.id=j.project_id
      WHERE j.id=$1 AND j.owner_key=$2 AND p.owner_key=$2
        AND p.deleted_at IS NULL`,[id,owner])).rows[0]??null;
 }
 async latest(owner:string,projectId:string,revision:number):Promise<GlbPreviewJob|null>{
   return (await this.pool.query<GlbPreviewJob>(
     `SELECT j.* FROM bw_glb_preview_jobs j
      JOIN bw_projects p ON p.id=j.project_id
      WHERE j.project_id=$1 AND j.source_revision=$3
        AND j.owner_key=$2 AND p.owner_key=$2 AND p.deleted_at IS NULL
        AND j.status='completed' AND j.sha256 IS NOT NULL AND j.size_bytes IS NOT NULL
      ORDER BY j.created_at DESC,j.id DESC LIMIT 1`,
     [projectId,owner,revision])).rows[0]??null;
 }
 async claimNext():Promise<GlbPreviewJob|null>{
   return (await this.pool.query<GlbPreviewJob>(
     `WITH next AS (
       SELECT j.id FROM bw_glb_preview_jobs j
       JOIN bw_projects p ON p.id=j.project_id
       JOIN bw_modal_accounts a ON a.owner_key=j.owner_key AND a.status='connected'
       WHERE j.status='pending' AND p.owner_key=j.owner_key AND p.deleted_at IS NULL
       ORDER BY j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1
     ) UPDATE bw_glb_preview_jobs j SET status='running',updated_at=now()
       FROM next WHERE j.id=next.id AND j.status='pending' RETURNING j.*`)).rows[0]??null;
 }
 async complete(owner:string,id:string,sha:string,bytes:number):Promise<void>{
   if(!/^[a-f0-9]{64}$/.test(sha)||!Number.isSafeInteger(bytes)
      ||bytes<20||bytes>128*1024*1024)throw new RangeError('Invalid GLB metadata');
   const r=await this.pool.query(
     `UPDATE bw_glb_preview_jobs SET status='completed',sha256=$3,size_bytes=$4,
       error_code=NULL,updated_at=now(),finished_at=now()
       WHERE id=$1 AND owner_key=$2 AND status IN ('running','needs_recovery')
       RETURNING id`,[id,owner,sha,bytes]);
   if(!r.rowCount)throw new Error('GLB completion failed');
 }
 async fail(owner:string,id:string):Promise<void>{
   await this.pool.query(
     `UPDATE bw_glb_preview_jobs SET status='failed',error_code='preview_failed',
       updated_at=now(),finished_at=now()
       WHERE id=$1 AND owner_key=$2 AND status='running'`,[id,owner]);
 }
 async quarantineStale(minutes=30):Promise<number>{
   if(!Number.isInteger(minutes)||minutes<20||minutes>10080)
     throw new RangeError('Invalid interval');
   const r=await this.pool.query(
     `UPDATE bw_glb_preview_jobs SET status='needs_recovery',error_code='worker_unavailable',
        updated_at=now() WHERE status='running'
        AND updated_at<now()-($1::integer * interval '1 minute') RETURNING id`,
     [minutes]);
   return r.rowCount??0;
 }
}
