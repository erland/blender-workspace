import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
export interface Project {
  id:string;owner_key:string;name:string;description:string;current_revision:number;
  created_at:Date;updated_at:Date;deleted_at:Date|null;
}
export interface Revision {
  project_id:string;revision:number;note:string;artifact_prefix:string|null;created_at:Date;
}
function required(value:string,max:number,label:string) {
  if (!value.trim() || value.length>max) throw new RangeError(`${label} must be 1-${max} characters`);
  return value.trim();
}
function optional(value:string,max:number,label:string) {
  if (value.length>max) throw new RangeError(`${label} too long`);
  return value;
}
export class ProjectRepository {
  constructor(private pool:Pool) {}
  async create(owner:string,name:string,description=''):Promise<Project> {
    required(owner,200,'owner');required(name,200,'name');optional(description,5000,'description');
    const r=await this.pool.query<Project>(
      'INSERT INTO bw_projects(id,owner_key,name,description) VALUES($1,$2,$3,$4) RETURNING *',
      [randomUUID(),owner,name.trim(),description]);return r.rows[0];
  }
  async get(owner:string,id:string):Promise<Project|null> {
    required(owner,200,'owner');
    const r=await this.pool.query<Project>(
      'SELECT * FROM bw_projects WHERE id=$1 AND owner_key=$2 AND deleted_at IS NULL',[id,owner]);
    return r.rows[0]??null;
  }
  async list(owner:string,limit=50):Promise<Project[]> {
    required(owner,200,'owner');
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new RangeError('Invalid limit');
    return (await this.pool.query<Project>(
      'SELECT * FROM bw_projects WHERE owner_key=$1 AND deleted_at IS NULL ORDER BY updated_at DESC,id LIMIT $2',
      [owner,limit])).rows;
  }
  async rename(owner:string,id:string,name:string):Promise<Project|null> {
    required(owner,200,'owner');required(name,200,'name');
    const r=await this.pool.query<Project>(
      'UPDATE bw_projects SET name=$3,updated_at=now() WHERE id=$1 AND owner_key=$2 AND deleted_at IS NULL RETURNING *',
      [id,owner,name.trim()]);return r.rows[0]??null;
  }
  async updateDescription(owner:string,id:string,description:string):Promise<Project|null> {
    required(owner,200,'owner');optional(description,5000,'description');
    const r=await this.pool.query<Project>(
      'UPDATE bw_projects SET description=$3,updated_at=now() WHERE id=$1 AND owner_key=$2 AND deleted_at IS NULL RETURNING *',
      [id,owner,description]);
    return r.rows[0]??null;
  }
  async softDelete(owner:string,id:string):Promise<boolean> {
    required(owner,200,'owner');
    const r=await this.pool.query(
      `UPDATE bw_projects p SET deleted_at=now(),updated_at=now()
       WHERE p.id=$1 AND p.owner_key=$2 AND p.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM bw_jobs j WHERE j.project_id=p.id
             AND j.status IN ('pending','running','needs_recovery')
         )`,[id,owner]);
    return !!r.rowCount;
  }
  /** Durable tombstone. Locks the project row to serialize with job reservation.
   * Active/recoverable work must complete or be handled explicitly first.
   */
  /** Stage an imported project in a hidden state until every artifact exists. */
  async beginImport(owner:string,name:string,description:string):Promise<Project> {
    required(owner,200,'owner');required(name,200,'name');optional(description,5000,'description');
    const r=await this.pool.query<Project>(
      'INSERT INTO bw_projects(id,owner_key,name,description,deleted_at) VALUES($1,$2,$3,$4,now()) RETURNING *',
      [randomUUID(),owner,name.trim(),description]);
    return r.rows[0];
  }
  /** Publish imported revisions atomically. The archive contains metadata only;
   * no copied job can become a running job in the destination.
   */
  async finishImport(owner:string,id:string,entries:{revision:number;note:string;createdAt:string}[]):Promise<void> {
    required(owner,200,'owner');
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN');
      const p=await c.query(
        'SELECT id FROM bw_projects WHERE id=$1 AND owner_key=$2 AND deleted_at IS NOT NULL AND deletion_requested_at IS NULL FOR UPDATE',[id,owner]);
      if(!p.rowCount)throw new Error('Import project is not staged');
      for(let i=0;i<entries.length;i++){
        const r=entries[i];
        if(r.revision!==i+1||r.note.length>5000||!Number.isFinite(Date.parse(r.createdAt)))
          throw new RangeError('Invalid imported revision metadata');
        await c.query(
          'INSERT INTO bw_project_revisions(project_id,revision,note,artifact_prefix,created_at) VALUES($1,$2,$3,$4,$5)',
          [id,r.revision,r.note,id+'/'+String(r.revision).padStart(8,'0'),r.createdAt]);
      }
      await c.query('UPDATE bw_projects SET current_revision=$2,deleted_at=NULL,updated_at=now() WHERE id=$1 AND owner_key=$3',
        [id,entries.length,owner]);
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  /** Never leave a hidden failed import indefinitely. */
  async cancelImport(owner:string,id:string):Promise<void> {
    required(owner,200,'owner');
    await this.pool.query(
      'DELETE FROM bw_projects WHERE id=$1 AND owner_key=$2 AND deleted_at IS NOT NULL AND deletion_requested_at IS NULL',[id,owner]);
  }
  async beginPermanentDelete(owner:string,id:string):Promise<'ready'|'busy'|'missing'> {
    required(owner,200,'owner');
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN');
      const p=await c.query<Project>(
        'SELECT * FROM bw_projects WHERE id=$1 AND owner_key=$2 FOR UPDATE',[id,owner]);
      if(!p.rowCount){await c.query('ROLLBACK');return 'missing';}
      const active=await c.query(
        "SELECT id FROM bw_jobs WHERE project_id=$1 AND status IN ('pending','running','needs_recovery') LIMIT 1",[id]);
      const rendering=await c.query(
        "SELECT id FROM bw_render_jobs WHERE project_id=$1 AND status IN ('pending','running','needs_recovery') LIMIT 1",[id]);
      if(active.rowCount||rendering.rowCount){await c.query('ROLLBACK');return 'busy';}
      await c.query('UPDATE bw_projects SET deleted_at=COALESCE(deleted_at,now()),deletion_requested_at=COALESCE(deletion_requested_at,now()),updated_at=now() WHERE id=$1',[id]);
      await c.query('COMMIT');
      return 'ready';
    }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
  }
  /** Finalize only after the storage directory has been removed. Idempotent. */
  async finishPermanentDelete(owner:string,id:string):Promise<boolean> {
    required(owner,200,'owner');
    const c=await this.pool.connect();
    try{
      await c.query('BEGIN');
      const p=await c.query(
        'SELECT id FROM bw_projects WHERE id=$1 AND owner_key=$2 AND deletion_requested_at IS NOT NULL FOR UPDATE',[id,owner]);
      if(!p.rowCount){await c.query('ROLLBACK');return false;}
      const active=await c.query(
        "SELECT id FROM bw_jobs WHERE project_id=$1 AND status IN ('pending','running','needs_recovery') LIMIT 1",[id]);
      const rendering=await c.query(
        "SELECT id FROM bw_render_jobs WHERE project_id=$1 AND status IN ('pending','running','needs_recovery') LIMIT 1",[id]);
      if(active.rowCount||rendering.rowCount)throw new Error('Active job prevents project cleanup');
      await c.query('DELETE FROM bw_render_jobs WHERE project_id=$1',[id]);
      await c.query('DELETE FROM bw_jobs WHERE project_id=$1',[id]);
      await c.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[id]);
      await c.query('DELETE FROM bw_projects WHERE id=$1 AND owner_key=$2',[id,owner]);
      await c.query('COMMIT');
      return true;
    }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
  }
  /** Resumable cleanup of tombstones, including projects hidden by older soft-delete UI. */
  async pendingPermanentDeletes(limit=50):Promise<{id:string;owner_key:string}[]> {
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new RangeError('Invalid limit');
    return (await this.pool.query<{id:string;owner_key:string}>(
      'SELECT id,owner_key FROM bw_projects WHERE deletion_requested_at IS NOT NULL ORDER BY deletion_requested_at,id LIMIT $1',
      [limit])).rows;
  }
  async addRevision(owner:string,id:string,note='',artifactPrefix:string|null=null):Promise<Revision|null> {
    required(owner,200,'owner');optional(note,5000,'note');
    if(artifactPrefix!==null)required(artifactPrefix,1024,'artifactPrefix');
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN');
      const p=await c.query<{current_revision:number}>(
        'SELECT current_revision FROM bw_projects WHERE id=$1 AND owner_key=$2 AND deleted_at IS NULL FOR UPDATE',[id,owner]);
      if(!p.rowCount){await c.query('ROLLBACK');return null;}
      const revision=p.rows[0].current_revision+1;
      const r=await c.query<Revision>(
        'INSERT INTO bw_project_revisions(project_id,revision,note,artifact_prefix) VALUES($1,$2,$3,$4) RETURNING *',
        [id,revision,note,artifactPrefix]);
      await c.query('UPDATE bw_projects SET current_revision=$2,updated_at=now() WHERE id=$1',[id,revision]);
      await c.query('COMMIT');return r.rows[0];
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async revisions(owner:string,id:string):Promise<Revision[]> {
    required(owner,200,'owner');
    return (await this.pool.query<Revision>(
      `SELECT r.* FROM bw_project_revisions r JOIN bw_projects p ON p.id=r.project_id
       WHERE p.id=$1 AND p.owner_key=$2 AND p.deleted_at IS NULL ORDER BY r.revision`,[id,owner])).rows;
  }
}
