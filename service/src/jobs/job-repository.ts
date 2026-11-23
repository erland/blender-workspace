import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {parsePythonScript,type PythonScriptSpec} from './python-script.js';
import {preflightPython} from './python-preflight.js';
import {safeStoredJobError} from './job-diagnostics.js';
import {parseAssetSources,type AssetSource} from './asset-sources.js';

export type JobStatus = 'pending'|'running'|'needs_recovery'|'completed'|'failed';
export interface Job {
  id:string; project_id:string;owner_key:string; expected_revision:number;source_revision:number|null;asset_sources:AssetSource[];
  requested_revision:number;status:JobStatus;note:string;error_message:string|null;created_at:Date;updated_at:Date;finished_at:Date|null;edit_spec:unknown|null;operation_spec:PythonScriptSpec|null;
  started_at:Date|null;worker_heartbeat_at:Date|null;blender_heartbeat_at:Date|null;
  progress_phase:string|null;deadline_at:Date|null;
}
export class JobConflict extends Error {
  constructor(message:string) {super(message);this.name='JobConflict';}
}
export class JobRepository {
  constructor(private readonly pool:Pool) {}
  async reserve(owner:string, projectId:string, expectedRevision:number, note='',_retiredEdit?:never,operation?:PythonScriptSpec, sourceRevision?:number, assetSources?:AssetSource[]):Promise<Job> {
    if (!owner.trim() || owner.length>200 || note.length>5000 || !Number.isSafeInteger(expectedRevision) ||
        expectedRevision<0 || expectedRevision>99999998)
      throw new RangeError('Invalid job input');
    if(sourceRevision!==undefined && (!Number.isSafeInteger(sourceRevision)||
      sourceRevision<1||sourceRevision>expectedRevision))
      throw new RangeError('Source revision must be a saved predecessor');
    if(expectedRevision===0&&sourceRevision!==undefined)
      throw new RangeError('Initial scene cannot use a source revision');
    // The public MCP writer is Python-only. Also reject internal callers
    // before opening a database transaction: no new demo/typed jobs may queue.
    if(_retiredEdit!==undefined)throw new RangeError('Structured scene edits are retired');
    if(operation===undefined)throw new RangeError('Python script is required');
    const safeOperation=parsePythonScript(operation);
    const selectedAssets=parseAssetSources(assetSources);
    // Last gate before reservation: no syntax-invalid script can be dispatched.
    await preflightPython(safeOperation.code);
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const p=await client.query<{current_revision:number}>(
        `SELECT current_revision FROM bw_projects
         WHERE id=$1 AND owner_key=$2 AND deleted_at IS NULL FOR UPDATE`,[projectId,owner]);
      if (!p.rowCount) throw new JobConflict('Project not found or unauthorized');
      if (p.rows[0].current_revision !== expectedRevision) throw new JobConflict('Stale project revision');
      const selectedSource=expectedRevision===0?null:(sourceRevision??expectedRevision);
      if(selectedSource!==null){
        const source=await client.query(
          `SELECT 1 FROM bw_project_revisions WHERE project_id=$1 AND revision=$2
           AND artifact_prefix IS NOT NULL`,[projectId,selectedSource]);
        if(!source.rowCount)throw new JobConflict('Selected source revision is unavailable');
      }
      await this.assertOwnedSources(client,owner,selectedAssets);
      const j=await client.query<Job>(`INSERT INTO bw_jobs
        (id,project_id,owner_key,expected_revision,requested_revision,source_revision,asset_sources,status,note,edit_spec,operation_spec)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'pending',$8,$9::jsonb,$10::jsonb) RETURNING *`,
        [randomUUID(),projectId,owner,expectedRevision,expectedRevision+1,selectedSource,
          JSON.stringify(selectedAssets),note,null,JSON.stringify(safeOperation)]);
      await client.query('COMMIT');
      return j.rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as {code?:string}).code==='23505') throw new JobConflict('Another job is active');
      throw e;
    } finally { client.release(); }
  }
  private async assertOwnedSources(
    db:Pick<Pool,'query'>,owner:string,sources:AssetSource[]):Promise<void>{
    for(const source of sources){
      if('uploadId' in source){
        const result=await db.query<{format:string}>(
          'SELECT format FROM bw_uploaded_assets WHERE id=$1 AND owner_key=$2',
          [source.uploadId,owner]);
        if(!result.rowCount||!(
          'texture' in source
            ?['png','jpg'].includes(result.rows[0].format)
            :['blend','glb'].includes(result.rows[0].format)
        ))throw new JobConflict('Uploaded asset is unavailable or has wrong type');
        continue;
      }
      const res=await db.query(
        `SELECT 1 FROM bw_project_revisions r
          JOIN bw_projects p ON p.id=r.project_id
          WHERE p.id=$1 AND p.owner_key=$2 AND p.deleted_at IS NULL
            AND r.revision=$3 AND r.artifact_prefix IS NOT NULL`,
        [source.projectId,owner,source.revision]);
      if(!res.rowCount)throw new JobConflict('Model source is unavailable');
    }
  }
  /** Revalidate queued owner-scoped source references before spending Modal credits. */
  async validateAssetSources(owner:string,sources:AssetSource[]):Promise<AssetSource[]>{
    const safe=parseAssetSources(sources);
    await this.assertOwnedSources(this.pool,owner,safe);
    return safe;
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
    UPDATE bw_jobs j SET status='running',updated_at=now(),started_at=now(),
      worker_heartbeat_at=now(),progress_phase='preparing',deadline_at=now()+interval '19 minutes'
    FROM next WHERE j.id=next.id AND j.status='pending'
    RETURNING j.*`);
    return r.rows[0]??null;
  }
  /** Quarantine stale running jobs; never re-run a potentially billed Modal job automatically. */
  async quarantineStaleRunning(minAgeMinutes=30):Promise<number>{
    if(!Number.isInteger(minAgeMinutes)||minAgeMinutes<20||minAgeMinutes>10080)
      throw new RangeError('Invalid stale-job interval');
    const r=await this.pool.query(`UPDATE bw_jobs
      SET status='needs_recovery',error_message='BW_JOB_ERROR phase=setup code=worker_timeout',
        updated_at=now()
      WHERE status='running' AND (
        (COALESCE(worker_heartbeat_at,updated_at) < now()-($1::integer * interval '1 minute'))
        OR (deadline_at IS NOT NULL AND deadline_at < now()))
      RETURNING id`,[minAgeMinutes]);
    return r.rowCount??0;
  }
  /** A live worker periodically renews this lease; terminal/recovery jobs cannot be revived. */
  async heartbeat(owner:string,id:string,phase?:string,blenderSignal=false):Promise<boolean> {
    const safePhases=['preparing','modal_start','blender_execution','artifact_transfer',
      'artifact_validation','artifact_storage','revision_commit'];
    if(phase!==undefined&&!safePhases.includes(phase))throw new RangeError('Invalid progress phase');
    const result=await this.pool.query(`UPDATE bw_jobs SET
      worker_heartbeat_at=now(),updated_at=now(),
      progress_phase=COALESCE($3,progress_phase),
      blender_heartbeat_at=CASE WHEN $4::boolean THEN now() ELSE blender_heartbeat_at END
      WHERE id=$1 AND owner_key=$2 AND status='running'
      RETURNING id`,[id,owner,phase??null,blenderSignal]);
    return (result.rowCount??0)===1;
  }
  /** Watchdog never claims a job has stopped at Modal; ambiguous jobs need recovery. */
  /** Bounded, owner-scoped history for the web portal; never returns Python source. */
  async list(owner:string,projectId?:string,limit=50):Promise<Job[]> {
    if(!owner.trim()||owner.length>200||!Number.isInteger(limit)||limit<1||limit>100)
      throw new RangeError('Invalid job history request');
    return (await this.pool.query<Job>(
      `SELECT j.id,j.project_id,j.owner_key,j.expected_revision,j.requested_revision,j.source_revision,j.asset_sources,
         j.status,j.note,j.error_message,j.created_at,j.updated_at,j.finished_at
       FROM bw_jobs j JOIN bw_projects p ON p.id=j.project_id
       WHERE j.owner_key=$1 AND p.owner_key=$1 AND p.deleted_at IS NULL
         AND ($2::uuid IS NULL OR j.project_id=$2::uuid)
       ORDER BY j.created_at DESC,j.id DESC LIMIT $3`,
      [owner,projectId??null,limit])).rows;
  }
  /** Identify successful older inline previews not yet registered in the
   * shared render gallery. This is metadata-only; reconciliation never runs
   * Blender or queues Modal.
   */
  async listUnregisteredInlineRenders(limit=100):Promise<Job[]> {
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new RangeError('Invalid limit');
    return (await this.pool.query<Job>(
      `SELECT j.* FROM bw_jobs j
       JOIN bw_projects p ON p.id=j.project_id AND p.owner_key=j.owner_key
       JOIN bw_project_revisions v ON v.project_id=j.project_id
         AND v.revision=j.requested_revision AND v.artifact_prefix IS NOT NULL
       LEFT JOIN bw_render_jobs r ON r.id=j.id
       WHERE j.status='completed' AND j.operation_spec->>'inlineRender'='true'
         AND p.deleted_at IS NULL AND r.id IS NULL
       ORDER BY j.created_at DESC LIMIT $1`,[limit])).rows;
  }
  async get(owner:string,id:string):Promise<Job|null> {
    if (!owner.trim() || owner.length>200) throw new RangeError('Invalid owner');
    const r=await this.pool.query<Job>(
      `SELECT j.* FROM bw_jobs j JOIN bw_projects p ON p.id=j.project_id
       WHERE j.id=$1 AND j.owner_key=$2 AND p.owner_key=$2 AND p.deleted_at IS NULL`,[id,owner]);
    return r.rows[0]??null;
  }
  async claim(owner:string,id:string):Promise<Job> {
    const r=await this.pool.query<Job>(`UPDATE bw_jobs SET status='running', updated_at=now(),started_at=now(),
      worker_heartbeat_at=now(),progress_phase='preparing',deadline_at=now()+interval '19 minutes'
      WHERE id=$1 AND owner_key=$2 AND status='pending' RETURNING *`,[id,owner]);
    if (!r.rowCount) throw new JobConflict('Job is not pending');
    return r.rows[0];
  }
  async markFailed(owner:string,id:string,error:unknown):Promise<void> {
    await this.pool.query(`UPDATE bw_jobs SET status='failed',error_message=$3,
      updated_at=now(),finished_at=now()
      WHERE id=$1 AND owner_key=$2 AND status IN ('running','pending')`,
      [id,owner,safeStoredJobError(error)]);
  }
  async markRecoverable(owner:string,id:string,error:unknown):Promise<void> {
    await this.pool.query(`UPDATE bw_jobs SET status='needs_recovery',error_message=$3,
      updated_at=now() WHERE id=$1 AND owner_key=$2
      AND status IN ('running','needs_recovery')`,[id,owner,safeStoredJobError(error)]);
  }
  async finalize(owner:string,jobId:string,artifactPrefix:string,explicitRecovery=false):Promise<Job> {
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
      if(job.status!=='running' && !(explicitRecovery && job.status==='needs_recovery'))
        throw new JobConflict('Job not finalizable');
      if(!explicitRecovery && job.deadline_at && new Date(job.deadline_at).getTime()<Date.now())
        throw new JobConflict('Job execution deadline elapsed');
      const updated=await c.query(
        `UPDATE bw_projects SET current_revision=$3,updated_at=now()
         WHERE id=$1 AND owner_key=$2 AND current_revision=$4 AND deleted_at IS NULL
         RETURNING id`,[job.project_id,owner,job.requested_revision,job.expected_revision]);
      if(!updated.rowCount)throw new JobConflict('Project revision changed');
      await c.query(`INSERT INTO bw_project_revisions(project_id,revision,note,artifact_prefix,source_revision)
        VALUES($1,$2,$3,$4,$5)`,[job.project_id,job.requested_revision,job.note,artifactPrefix,
          job.source_revision??(job.expected_revision>0?job.expected_revision:null)]);
      const finished=await c.query<Job>(`UPDATE bw_jobs SET status='completed',error_message=NULL,
        updated_at=now(),finished_at=now() WHERE id=$1 RETURNING *`,[jobId]);
      await c.query('COMMIT');
      return finished.rows[0];
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
}
