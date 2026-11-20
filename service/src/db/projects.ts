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
