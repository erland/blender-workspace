import {createHash,randomBytes} from 'node:crypto';
import type {Pool} from 'pg';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
function validProject(id:string,revision:number):void {
  if(!UUID.test(id)||!Number.isSafeInteger(revision)||revision<1||revision>99999999)
    throw new RangeError('Invalid public share revision');
}
function digest(token:string):string {
  if(!TOKEN.test(token))throw new RangeError('Invalid share token');
  return createHash('sha256').update(token,'utf8').digest('hex');
}
export interface PublicRevisionShare {
  project_id:string;
  revision:number;
  owner_key:string;
  project_name:string;
  project_description:string;
  created_at:Date;
  expires_at:Date|null;
  allow_glb:boolean;
  allow_renders:boolean;
  allow_download:boolean;
  selected_render_ids:string[];
}
export interface OwnedRevisionShare {
  project_id:string;
  revision:number;
  created_at:Date;
  expires_at:Date|null;
  revoked_at:Date|null;
  allow_glb:boolean;
  allow_renders:boolean;
  allow_download:boolean;
  selected_render_ids:string[];
}
/** All writes are owner scoped; public reads require a full-length random token.
 * No public token ever appears in database records or list responses.
 */
export class PublicShareRepository {
  constructor(private readonly pool:Pick<Pool,'query'>){}
  async create(owner:string,projectId:string,revision:number):Promise<{token:string}>{
    validProject(projectId,revision);
    if(!owner||owner.length>200)throw new RangeError('Invalid owner');
    const token=randomBytes(32).toString('base64url');
    const sha=digest(token);
    const result=await this.pool.query(
      `INSERT INTO bw_public_shares
         (project_id,revision,owner_key,token_sha256,allow_glb,allow_renders,
          allow_download,selected_render_ids,revoked_at,expires_at,created_at)
       SELECT p.id,r.revision,p.owner_key,$4,true,false,false,'{}'::uuid[],
         NULL,NULL,now()
       FROM bw_projects p JOIN bw_project_revisions r ON r.project_id=p.id
       WHERE p.id=$1 AND p.owner_key=$2 AND p.deleted_at IS NULL
         AND r.revision=$3 AND r.artifact_prefix IS NOT NULL
       ON CONFLICT (project_id,revision) DO UPDATE SET
         token_sha256=EXCLUDED.token_sha256,owner_key=EXCLUDED.owner_key,
         allow_glb=true,allow_renders=false,allow_download=false,
         selected_render_ids='{}'::uuid[],revoked_at=NULL,expires_at=NULL,
         created_at=now()
       RETURNING project_id`,
      [projectId,owner,revision,sha]);
    if(!result.rowCount)throw new Error('Revision is not owned or unavailable');
    return {token};
  }
  async owned(owner:string,projectId:string,revision:number):Promise<OwnedRevisionShare|null>{
    validProject(projectId,revision);
    const res=await this.pool.query<OwnedRevisionShare>(
      `SELECT s.project_id,s.revision,s.created_at,s.expires_at,s.revoked_at,
         s.allow_glb,s.allow_renders,s.allow_download,s.selected_render_ids
       FROM bw_public_shares s JOIN bw_projects p ON p.id=s.project_id
       WHERE p.id=$1 AND p.owner_key=$2 AND s.owner_key=$2
         AND p.deleted_at IS NULL AND s.revision=$3`,
      [projectId,owner,revision]);
    return res.rows[0]??null;
  }
  /** Replaces the explicit public image snapshot without rotating the share
   * token. Atomic SQL ensures all chosen rows are owner-scoped, from the same
   * exact revision, completed and backed by a recorded SHA-256 PNG. A
   * non-existent / revoked share cannot be changed.
   */
  async setSelectedRenders(owner:string,projectId:string,revision:number,ids:string[]):Promise<boolean>{
    validProject(projectId,revision);
    if(!owner||owner.length>200||!Array.isArray(ids)||ids.length>12||
      new Set(ids.map(id=>id.toLowerCase())).size!==ids.length||
      ids.some(id=>typeof id!=='string'||!UUID.test(id)))
      throw new RangeError('Invalid public render selection');
    const selected=ids.map(id=>id.toLowerCase());
    const result=await this.pool.query(
      `UPDATE bw_public_shares s
       SET selected_render_ids=$4::uuid[],allow_renders=(cardinality($4::uuid[])>0)
       FROM bw_projects p
       WHERE s.project_id=$1 AND s.owner_key=$2 AND s.revision=$3
         AND p.id=s.project_id AND p.owner_key=$2 AND p.deleted_at IS NULL
         AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>now())
         AND NOT EXISTS (
           SELECT 1 FROM unnest($4::uuid[]) chosen(id)
           LEFT JOIN bw_render_jobs j ON j.id=chosen.id AND j.project_id=s.project_id
             AND j.owner_key=s.owner_key AND j.source_revision=s.revision
             AND j.status='completed' AND j.sha256 IS NOT NULL
             AND j.size_bytes IS NOT NULL
           WHERE j.id IS NULL
         ) RETURNING s.project_id`,
      [projectId,owner,revision,selected]);
    return Boolean(result.rowCount);
  }
  async revoke(owner:string,projectId:string,revision:number):Promise<boolean>{
    validProject(projectId,revision);
    const res=await this.pool.query(
      `UPDATE bw_public_shares s SET revoked_at=now()
       FROM bw_projects p WHERE p.id=s.project_id AND p.owner_key=$2
         AND s.owner_key=$2 AND p.deleted_at IS NULL
         AND s.project_id=$1 AND s.revision=$3 AND s.revoked_at IS NULL`,
      [projectId,owner,revision]);
    return Boolean(res.rowCount);
  }
  async resolve(token:string):Promise<PublicRevisionShare|null>{
    if(!TOKEN.test(token))return null;
    const res=await this.pool.query<PublicRevisionShare>(
      `SELECT s.project_id,s.revision,s.owner_key,
         p.name AS project_name,p.description AS project_description,
         s.created_at,s.expires_at,s.allow_glb,s.allow_renders,
         s.allow_download,s.selected_render_ids
       FROM bw_public_shares s
       JOIN bw_projects p ON p.id=s.project_id AND p.owner_key=s.owner_key
       JOIN bw_project_revisions r ON r.project_id=s.project_id AND r.revision=s.revision
       WHERE s.token_sha256=$1 AND s.revoked_at IS NULL
         AND (s.expires_at IS NULL OR s.expires_at>now())
         AND s.allow_glb=true AND s.allow_download=false
         AND (
           (s.allow_renders=false AND cardinality(s.selected_render_ids)=0)
           OR (s.allow_renders=true AND cardinality(s.selected_render_ids) BETWEEN 1 AND 12)
         ) AND p.deleted_at IS NULL
         AND r.artifact_prefix IS NOT NULL`,
      [digest(token)]);
    return res.rows[0]??null;
  }
}
export function validShareToken(token:string):boolean{return TOKEN.test(token);}
