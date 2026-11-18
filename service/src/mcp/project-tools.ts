import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ProjectRepository } from '../db/projects.js';
import {JobConflict,type JobRepository} from '../jobs/job-repository.js';
import {READ_SCOPE,WRITE_SCOPE} from '../auth/oauth.js';
import type {ModalAccountManager} from '../modal/modal-accounts.js';
import {SceneEditSchema} from '../jobs/scene-edit.js';
import {SceneOperationSchema,isValidInitialSceneOperation} from '../jobs/scene-operation.js';
import type {LocalArtifactStore} from '../storage/artifact-store.js';
import {inspectSavedScene} from '../scene/scene-contract.js';

export interface ProjectServices {
  ownerKey: string;
  projects: ProjectRepository;
  jobs: JobRepository;
  modalAccounts?: Pick<ModalAccountManager,'status'|'test'|'disconnect'|'saveAndTest'>;
  artifacts?:Pick<LocalArtifactStore,'inspect'|'verifiedArtifactPath'>;
  viewerOrigin?:string;
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
/** Registers owner-scoped tools. OAuth scopes and owner identity come only from verified request context. */
export function registerProjectTools(server:McpServer,deps:ProjectServices,
 permissions?:ReadonlySet<string>,oauth=false,resource?:string):void {
  const {ownerKey,projects,jobs,modalAccounts,artifacts,viewerOrigin}=deps;
  const viewerLink=(projectId:string,revision:number)=>
    viewerOrigin+'/viewer/'+encodeURIComponent(projectId)+'/revisions/'+revision;
  async function ownedViewerRevision(projectId:string,revision:number):Promise<boolean>{
    if(!viewerOrigin||!artifacts)return false;
    const project=await projects.get(ownerKey,projectId);
    if(!project)return false;
    const revisions=await projects.revisions(ownerKey,projectId);
    if(!revisions.some(v=>v.revision===revision&&v.artifact_prefix))return false;
    try{await artifacts.verifiedArtifactPath(projectId,revision,'scene.glb');return true;}
    catch{return false;}
  }
  const allowed=permissions??new Set([READ_SCOPE,WRITE_SCOPE]);
  const denied=(scope:string)=>allowed.has(scope)?null:{
    isError:true,
    content:[{type:'text' as const,text:'Insufficient OAuth scope'}],
    ...(oauth&&resource?{_meta:{'mcp/www_authenticate':[
      'Bearer resource_metadata="'+new URL('/.well-known/oauth-protected-resource'+new URL(resource).pathname,resource).toString()+'", error="insufficient_scope", error_description="Required scope: '+scope+'"'
    ]}}:{})
  };
  const schemes=(scope:string)=>oauth?{_meta:{securitySchemes:[{type:'oauth2' as const,scopes:[scope]}]}}:{};

  server.registerTool('workspace_list_projects', {
    description: 'List Blender Workspace projects owned by this configured workspace identity.',
    inputSchema: {limit: z.number().int().min(1).max(100).optional()},
    annotations: {readOnlyHint:true},...schemes(READ_SCOPE)
  }, async ({limit}) => {
    const block=denied(READ_SCOPE);if(block)return block;
    try { return result({projects:(await projects.list(ownerKey,limit??50)).map(safeProject)}); }
    catch(e) { return failure(e); }
  });
  server.registerTool('workspace_create_project', {
    description: 'Create an empty Blender Workspace project. Does not run Blender.',
    inputSchema: {name:cleanName, description:cleanDescription.optional()},...schemes(WRITE_SCOPE)
  }, async ({name,description}) => {
    const block=denied(WRITE_SCOPE);if(block)return block;
    try { return result({project:safeProject(await projects.create(ownerKey,name,description??''))}); }
    catch(e) { return failure(e); }
  });
  server.registerTool('workspace_get_project', {
    description: 'Read metadata for a project you own.',
    inputSchema: {projectId:uuid}, annotations: {readOnlyHint:true},...schemes(READ_SCOPE)
  }, async ({projectId}) => {
    const block=denied(READ_SCOPE);if(block)return block;
    try { const p=await projects.get(ownerKey,projectId);return p?result({project:safeProject(p)}):failure(new JobConflict('Project not found')); }
    catch(e) { return failure(e); }
  });
  server.registerTool('workspace_rename_project', {
    description: 'Rename an existing Blender Workspace project you own.',
    inputSchema: {projectId:uuid,name:cleanName},...schemes(WRITE_SCOPE)
  }, async ({projectId,name}) => {
    const block=denied(WRITE_SCOPE);if(block)return block;
    try {const p=await projects.rename(ownerKey,projectId,name);return p?result({project:safeProject(p)}):failure(new JobConflict('Project not found')); }
    catch(e) {return failure(e);}
  });
  server.registerTool('workspace_list_revisions', {
    description: 'List saved Blender project revisions for a project you own.',
    inputSchema: {projectId:uuid}, annotations: {readOnlyHint:true},...schemes(READ_SCOPE)
  }, async ({projectId}) => {
    const block=denied(READ_SCOPE);if(block)return block;
    try { const p=await projects.get(ownerKey,projectId);
      if(!p)return failure(new JobConflict('Project not found'));
      const versions=await projects.revisions(ownerKey,projectId);
      return result({revisions:versions.map(v=>({revision:v.revision,createdAt:v.created_at,note:v.note,artifactAvailable:v.artifact_prefix!==null}))}); }
    catch(e){return failure(e);}
  });
  server.registerTool('workspace_inspect_scene',{
    description:'Read the actual object list and scene metadata saved with one owned Blender project revision. Works for arbitrary object names, meshes, lights, cameras, armatures and other scene objects. Read-only; does not execute Blender.',
    inputSchema:{projectId:uuid,revision:z.number().int().min(1).max(99999999)},
    annotations:{readOnlyHint:true},...schemes(READ_SCOPE)
  },async({projectId,revision})=>{
    const block=denied(READ_SCOPE);if(block)return block;
    try{
      const project=await projects.get(ownerKey,projectId);
      if(!project)return failure(new JobConflict('Project not found'));
      const revisions=await projects.revisions(ownerKey,projectId);
      if(!revisions.some(v=>v.revision===revision&&v.artifact_prefix))
        return failure(new JobConflict('Saved project revision not found'));
      if(!artifacts)return failure(new JobConflict('Scene inspection is not configured'));
      const scene=await inspectSavedScene(artifacts,projectId,revision);
      return result({projectId,revision,scene});
    }catch{return failure(new JobConflict('Scene metadata could not be verified'));}
  });
  if(viewerOrigin){
    server.registerTool('workspace_get_viewer_link',{
      description:'Get a browser link to an already saved GLB scene revision you own. The link does not contain access tokens. Opening it requires your own Google browser login; no Blender/Modal job is started.',
      inputSchema:{projectId:uuid,revision:z.number().int().min(1).max(99999999)},
      annotations:{readOnlyHint:true},...schemes(READ_SCOPE)
    },async({projectId,revision})=>{
      const block=denied(READ_SCOPE);if(block)return block;
      try{
        if(!await ownedViewerRevision(projectId,revision))
          return failure(new JobConflict('Saved GLB revision not found'));
        return result({projectId,revision,viewerUrl:viewerLink(projectId,revision),
          requiresGoogleLogin:true,modalExecution:false});
      }catch{return failure(new JobConflict('Saved GLB revision not found'));}
    });
  }
  server.registerTool('workspace_queue_scene_operation',{
    description:'Queue one or a batch (1–20) of bounded Blender operations independent of model type: add named primitives, change transforms or color, duplicate meshes, rename or delete objects. A new scene must begin with add_primitive. Operations execute in order in one immutable revision. No user Python code.',
    inputSchema:{projectId:uuid,expectedRevision:z.number().int().min(0).max(99999998),
      operation:SceneOperationSchema,note:note.optional()},...schemes(WRITE_SCOPE)
  },async({projectId,expectedRevision,operation,note:jobNote})=>{
    const deniedWrite=denied(WRITE_SCOPE);if(deniedWrite)return deniedWrite;
    try{
      if(modalAccounts&&!(await modalAccounts.status(ownerKey)).connected)
        return failure(new JobConflict('Connect your Modal account before queueing jobs'));
      const project=await projects.get(ownerKey,projectId);
      if(!project)return failure(new JobConflict('Project not found'));
      if(project.current_revision!==expectedRevision)
        return failure(new JobConflict('Stale project revision'));
      if(expectedRevision===0){
        if(!isValidInitialSceneOperation(operation))
          return failure(new JobConflict('Initial scene must add a primitive'));
      }else{
        const history=await projects.revisions(ownerKey,projectId);
        if(!history.some(v=>v.revision===expectedRevision&&v.artifact_prefix))
          return failure(new JobConflict('Saved source revision not found'));
        if(!artifacts)return failure(new JobConflict('Generic artifacts are not configured'));
        const manifest=await artifacts.inspect(projectId,expectedRevision);
        if(!manifest.artifacts.some(v=>v.name==='scene.blend'))
          return failure(new JobConflict('Generic scene source is required'));
      }
      const job=await jobs.reserve(ownerKey,projectId,expectedRevision,
        jobNote??'Structured Blender operation',undefined,operation);
      return result({job:safeJob(job),operation,message:'Queued generic Blender scene operation'});
    }catch{return failure(new JobConflict('Scene operation could not be queued'));}
  });
  server.registerTool('workspace_queue_demo', {
    description: 'Queue the first cube-monster demonstration revision for automatic execution by the separate dispatcher. Requires a connected Modal account.',
    inputSchema: {projectId:uuid,note:note.optional()},...schemes(WRITE_SCOPE)
  }, async ({projectId,note:jobNote}) => {
    const block=denied(WRITE_SCOPE);if(block)return block;
    try {
      if(modalAccounts && !(await modalAccounts.status(ownerKey)).connected)
        return failure(new JobConflict('Connect your Modal account before queueing jobs'));
      const job=await jobs.reserve(ownerKey,projectId,0,jobNote??'Create cube monster');
      return result({job:safeJob(job),message:'Queued for automatic worker dispatch'});
    } catch(e) {return failure(e);}
  });
  server.registerTool('workspace_queue_recolor_blue', {
    description:'Create revision 2 from your saved revision 1 Blender scene by recoloring the cube-monster body blue. Only this predefined, safe edit is supported.',
    inputSchema:{projectId:uuid,note:note.optional()},...schemes(WRITE_SCOPE)
  },async({projectId,note:jobNote})=>{
    const block=denied(WRITE_SCOPE);if(block)return block;
    try{
      if(modalAccounts && !(await modalAccounts.status(ownerKey)).connected)
        return failure(new JobConflict('Connect your Modal account before queueing jobs'));
      const project=await projects.get(ownerKey,projectId);
      if(!project)return failure(new JobConflict('Project not found'));
      if(project.current_revision!==1)return failure(new JobConflict('Revision 1 is required'));
      const versions=await projects.revisions(ownerKey,projectId);
      if(!versions.some(v=>v.revision===1 && v.artifact_prefix))
        return failure(new JobConflict('Verified source revision is required'));
      const job=await jobs.reserve(ownerKey,projectId,1,jobNote??'Recolor monster blue');
      return result({job:safeJob(job),message:'Queued Blender revision 2 for automatic dispatch'});
    }catch(e){return failure(e);}
  });
  server.registerTool('workspace_queue_scene_edit',{
    description:'Queue a safe structured edit to the Body of an existing Blender scene. Supply absolute RGB color (0–1), location (-10..10) and/or scale (0.1..4); only the Body target is supported. Does not run arbitrary scripts.',
    inputSchema:{projectId:uuid,expectedRevision:z.number().int().min(1).max(99999998),
      edit:SceneEditSchema,note:note.optional()},...schemes(WRITE_SCOPE)
  },async({projectId,expectedRevision,edit,note:jobNote})=>{
    const blocked=denied(WRITE_SCOPE);if(blocked)return blocked;
    try{
      if(modalAccounts && !(await modalAccounts.status(ownerKey)).connected)
        return failure(new JobConflict('Connect your Modal account before queueing jobs'));
      const project=await projects.get(ownerKey,projectId);
      if(!project)return failure(new JobConflict('Project not found'));
      if(project.current_revision!==expectedRevision)
        return failure(new JobConflict('Stale project revision'));
      const versions=await projects.revisions(ownerKey,projectId);
      if(!versions.some(v=>v.revision===expectedRevision&&v.artifact_prefix))
        return failure(new JobConflict('Saved predecessor revision is required'));
      const job=await jobs.reserve(ownerKey,projectId,expectedRevision,
        jobNote??'Structured Body scene edit',edit);
      return result({job:safeJob(job),edit,message:'Queued structured scene edit'});
    }catch(error){return failure(error);}
  });
  if(modalAccounts){
    server.registerTool('workspace_modal_status',{
      description:'Read whether your own Modal account is connected; never returns credentials.',
      inputSchema:{},annotations:{readOnlyHint:true},...schemes(READ_SCOPE)
    },async()=>{
      const block=denied(READ_SCOPE);if(block)return block;
      try{return result({modal:await modalAccounts.status(ownerKey)});}
      catch{return failure(new Error('Modal account lookup failed'));}
    });
    server.registerTool('workspace_modal_test',{
      description:'Reverify your connected Modal account with Modal, without revealing secrets.',
      inputSchema:{},...schemes(WRITE_SCOPE)
    },async()=>{
      const block=denied(WRITE_SCOPE);if(block)return block;
      try{await modalAccounts.test(ownerKey);return result({verified:true});}
      catch{return failure(new Error('Modal account verification failed'));}
    });
    server.registerTool('workspace_modal_disconnect',{
      description:'Disconnect and delete only your own saved Modal account credentials.',
      inputSchema:{},...schemes(WRITE_SCOPE)
    },async()=>{
      const block=denied(WRITE_SCOPE);if(block)return block;
      try{await modalAccounts.disconnect(ownerKey);return result({connected:false});}
      catch{return failure(new Error('Modal account disconnect failed'));}
    });
  }
  server.registerTool('workspace_get_job', {
    description: 'Check the status of a Blender job owned by this workspace.',
    inputSchema: {jobId:uuid},annotations:{readOnlyHint:true},...schemes(READ_SCOPE)
  }, async ({jobId}) => {
    const block=denied(READ_SCOPE);if(block)return block;
    try {const j=await jobs.get(ownerKey,jobId);
      if(!j)return failure(new JobConflict('Job not found'));
      const job=safeJob(j);
      if(j.status==='completed'&&await ownedViewerRevision(j.project_id,j.requested_revision))
        return result({job,viewerUrl:viewerLink(j.project_id,j.requested_revision),
          requiresGoogleLogin:true});
      return result({job});
    } catch(e){return failure(e);}
  });
}
