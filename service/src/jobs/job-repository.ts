import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {parseSceneEdit,type SceneEdit} from './scene-edit.js';

export type JobStatus = 'pending'|'running'|'needs_recovery'|'completed'|'failed';
export interface Job {
  id:string; project_id:string;owner_key:string; expected_revision:number;
  requested_revision:number;status:JobStatus;note:string;error_message:string|null;edit_spec:SceneEdit|null;
}
export class JobConflict extends Error {
  constructor(message:string) {super(message);this.name='JobConflict';}
}
export class JobRepository {
  constructor(private readonly pool:Pool) {}
  async reserve(owner:string, projectId:string, expectedRevision:number, note='',edit?:SceneEdit):Promise<Job> {
    if (!owner.trim() || owner.length>200 || note.length>5000 || !Number.isSafeInteger(expectedRevision) ||
        expectedRevision<0 || expectedRevision>99999998)
      throw new RangeError('Invalid job input');
    const safeEdit=edit===undefined?null:parseSceneEdit(edit);
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const p=await client.query<{current_revision:number}>(
        `SELECT current_revision FROM bw_projects
         WHERE id=$1 AND owner_key=$2 AND deleted_at IS NULL FOR UPDATE`,[projectId,owner]);
      if (!p.rowCount) throw new JobConflict('Project not found or unauthorized');
      if (p.rows[0].current_revision !== expectedRevision) throw new JobConflict('Stale project revision');
      const j=await client.query<Job>(`INSERT INTO bw_jobs
        (id,project_id,owner_key,expected_revision,requested_revision,status,note,edit_spec)
        VALUES($1,$2,$3,$4,$5,'pending',$6,$7::jsonb) RETURNING *`,
        [randomUUID(),projectId,owner,expectedRevision,expectedRevision+1,note,safeEdit===null?null:JSON.stringify(safeEdit)]);
      await client.query('COMMIT');
      return j.rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as {code?:string}).code==='23505') throw new JobConflict('Another job is active');
      throw e;
    } finally { client.release(); }
  }
  /** Multiple dispatchers can claim distinct jobs without duplicate execution. */
  async claimNext():Promise<Job|null> {
    const r=await this.pool.query<Job>(`WITH next AS (
      SELECT j.id FROM bw_jobs j
      JOIN bw_projects p ON p.id=j.project_id
      JOIN bw_modal_accounts a ON a.owner_key=j.owner_key AND a.status='connected'
      WHERE j.status='pending' AND p.owner_key=j.owner_key
        AND p.deleted_at IS NULL
      ORDER BY j.created_at,j.id
      FOR UPDATE OF j SKIP LOCKED LIMIT 1
    )
    UPDATE bw_jobs j SET status='running',updated_at=now()
    FROM next WHERE j.id=next.id AND j.status='pending'
    RETURNING j.*`);
    return r.rows[0]??null;
  }
  /** Quarantine stale running jobs; never re-run a potentially billed Modal job automatically. */
  async quarantineStaleRunning(minAgeMinutes=30):Promise<number>{
    if(!Number.isInteger(minAgeMinutes)||minAgeMinutes<20||minAgeMinutes>10080)
      throw new RangeError('Invalid stale-job interval');
    const r=await this.pool.query(`UPDATE bw_jobs
      SET status='needs_recovery',error_message='Worker stopped unexpectedly; inspect artifacts before recovery',
        updated_at=now()
      WHERE status='running' AND updated_at < now()-($1::integer * interval '1 minute')
      RETURNING id`,[minAgeMinutes]);
    return r.rowCount??0;
  }
  async get(owner:string,id:string):Promise<Job|null> {
    if (!owner.trim() || owner.length>200) throw new RangeError('Invalid owner');
    const r=await this.pool.query<Job>(
      `SELECT j.* FROM bw_jobs j JOIN bw_projects p ON p.id=j.project_id
       WHERE j.id=$1 AND j.owner_key=$2 AND p.owner_key=$2 AND p.deleted_at IS NULL`,[id,owner]);
    return r.rows[0]??null;
  }
  async claim(owner:string,id:string):Promise<Job> {
    const r=await this.pool.query<Job>(`UPDATE bw_jobs SET status='running', updated_at=now()
      WHERE id=$1 AND owner_key=$2 AND status='pending' RETURNING *`,[id,owner]);
    if (!r.rowCount) throw new JobConflict('Job is not pending');
    return r.rows[0];
  }
  async markFailed(owner:string,id:string,error:unknown):Promise<void> {
    await this.pool.query(`UPDATE bw_jobs SET status='failed',error_message=$3,
      updated_at=now(),finished_at=now()
      WHERE id=$1 AND owner_key=$2 AND status IN ('running','pending')`,
      [id,owner,String(error).slice(0,1000)]);
  }
  async markRecoverable(owner:string,id:string,error:unknown):Promise<void> {
    await this.pool.query(`UPDATE bw_jobs SET status='needs_recovery',error_message=$3,
      updated_at=now() WHERE id=$1 AND owner_key=$2
      AND status IN ('running','needs_recovery')`,[id,owner,String(error).slice(0,1000)]);
  }
  async finalize(owner:string,jobId:string,artifactPrefix:string):Promise<Job> {
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN');
      const jr=await c.query<Job>(
        `SELECT j.* FROM bw_jobs j JOIN bw_projects p ON p.id=j.project_id
         WHERE j.id=$1 AND j.owner_key=$2 AND p.owner_key=$2 AND p.deleted_at IS NULL
         FOR UPDATE OF j,p`,[jobId,owner]);
      if(!jr.rowCount)throw new JobConflict('Job not found or unauthorized');
      const job=jr.rows[0];
      if(job.status==='completed'){await c.query('COMMIT');return job;}
      if(!['running','needs_recovery'].includes(job.status))throw new JobConflict('Job not finalizable');
      const updated=await c.query(
        `UPDATE bw_projects SET current_revision=$3,updated_at=now()
         WHERE id=$1 AND owner_key=$2 AND current_revision=$4 AND deleted_at IS NULL
         RETURNING id`,[job.project_id,owner,job.requested_revision,job.expected_revision]);
      if(!updated.rowCount)throw new JobConflict('Project revision changed');
      await c.query(`INSERT INTO bw_project_revisions(project_id,revision,note,artifact_prefix)
        VALUES($1,$2,$3,$4)`,[job.project_id,job.requested_revision,job.note,artifactPrefix]);
      const finished=await c.query<Job>(`UPDATE bw_jobs SET status='completed',error_message=NULL,
        updated_at=now(),finished_at=now() WHERE id=$1 RETURNING *`,[jobId]);
      await c.query('COMMIT');
      return finished.rows[0];
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
}
