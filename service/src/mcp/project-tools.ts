import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ProjectRepository } from '../db/projects.js';
import { JobConflict, type JobRepository } from '../jobs/job-repository.js';

export interface ProjectServices {
  ownerKey: string;
  projects: ProjectRepository;
  jobs: JobRepository;
}
const uuid = z.string().uuid();
const cleanName = z.string().trim().min(1).max(200);
const cleanDescription = z.string().max(5000);
const note = z.string().max(5000);
function result(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}
function failure(error: unknown) {
  const message = error instanceof JobConflict ? error.message
    : error instanceof RangeError ? 'Invalid project input'
    : 'Project operation failed';
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}
function safeProject(p: {id:string;name:string;description:string;current_revision:number;created_at:Date;updated_at:Date}) {
  return {id:p.id,name:p.name,description:p.description,currentRevision:p.current_revision,
    createdAt:p.created_at,updatedAt:p.updated_at};
}
function safeJob(j: {id:string;project_id:string;status:string;requested_revision:number;created_at?:Date}) {
  return {id:j.id,projectId:j.project_id,status:j.status,requestedRevision:j.requested_revision};
}
/** Single tenant prototype: a trusted bearer token maps to one fixed server-side owner key.
 * Never accept caller-specified owner identity; replace this with OAuth scopes in DEV-008.
 */
export function registerProjectTools(server: McpServer, deps: ProjectServices): void {
  const {ownerKey,projects,jobs} = deps;
  server.registerTool('workspace_list_projects', {
    description: 'List Blender Workspace projects owned by this configured workspace identity.',
    inputSchema: {limit: z.number().int().min(1).max(100).optional()},
    annotations: {readOnlyHint:true}
  }, async ({limit}) => {
    try { return result({projects:(await projects.list(ownerKey,limit??50)).map(safeProject)}); }
    catch(e) { return failure(e); }
  });
  server.registerTool('workspace_create_project', {
    description: 'Create an empty Blender Workspace project. Does not run Blender.',
    inputSchema: {name:cleanName, description:cleanDescription.optional()}
  }, async ({name,description}) => {
    try { return result({project:safeProject(await projects.create(ownerKey,name,description??''))}); }
    catch(e) { return failure(e); }
  });
  server.registerTool('workspace_get_project', {
    description: 'Read metadata for a project you own.',
    inputSchema: {projectId:uuid}, annotations: {readOnlyHint:true}
  }, async ({projectId}) => {
    try { const p=await projects.get(ownerKey,projectId);return p?result({project:safeProject(p)}):failure(new JobConflict('Project not found')); }
    catch(e) { return failure(e); }
  });
  server.registerTool('workspace_rename_project', {
    description: 'Rename an existing Blender Workspace project you own.',
    inputSchema: {projectId:uuid,name:cleanName}
  }, async ({projectId,name}) => {
    try {const p=await projects.rename(ownerKey,projectId,name);return p?result({project:safeProject(p)}):failure(new JobConflict('Project not found')); }
    catch(e) {return failure(e);}
  });
  server.registerTool('workspace_list_revisions', {
    description: 'List saved Blender project revisions for a project you own.',
    inputSchema: {projectId:uuid}, annotations: {readOnlyHint:true}
  }, async ({projectId}) => {
    try { const p=await projects.get(ownerKey,projectId);
      if(!p)return failure(new JobConflict('Project not found'));
      const versions=await projects.revisions(ownerKey,projectId);
      return result({revisions:versions.map(v=>({revision:v.revision,createdAt:v.created_at,note:v.note,artifactAvailable:v.artifact_prefix!==null}))}); }
    catch(e){return failure(e);}
  });
  server.registerTool('workspace_queue_demo', {
    description: 'Queue the first cube-monster demonstration revision. This does not start Modal immediately; an internal worker must execute the pending job.',
    inputSchema: {projectId:uuid,note:note.optional()}
  }, async ({projectId,note:jobNote}) => {
    try {
      const job=await jobs.reserve(ownerKey,projectId,0,jobNote??'Create cube monster');
      return result({job:safeJob(job),message:'Queued; awaiting worker execution'});
    } catch(e) {return failure(e);}
  });
  server.registerTool('workspace_get_job', {
    description: 'Check the status of a Blender job owned by this workspace.',
    inputSchema: {jobId:uuid},annotations:{readOnlyHint:true}
  }, async ({jobId}) => {
    try {const j=await jobs.get(ownerKey,jobId);
      return j?result({job:safeJob(j)}):failure(new JobConflict('Job not found'));
    } catch(e){return failure(e);}
  });
}
