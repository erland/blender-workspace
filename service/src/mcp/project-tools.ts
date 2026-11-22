import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ProjectRepository } from '../db/projects.js';
import {JobConflict,type JobRepository} from '../jobs/job-repository.js';
import {safeOwnerJobError} from '../jobs/job-diagnostics.js';
import {READ_SCOPE,WRITE_SCOPE} from '../auth/oauth.js';
import type {ModalAccountManager} from '../modal/modal-accounts.js';
import {PythonScriptSchema} from '../jobs/python-script.js';
import {preflightPython,PythonSyntaxError} from '../jobs/python-preflight.js';
import type {LocalArtifactStore} from '../storage/artifact-store.js';
import type {GlbPreviewRepository} from '../jobs/glb-preview-repository.js';
import type {GlbPreviewArtifactStore} from '../storage/glb-preview-artifacts.js';
import {validateRenderOptions,type RenderJobRepository,type RenderEngine} from '../jobs/render-repository.js';
import {inspectSavedScene,geometrySnapshot,geometryValidation,materialCatalog} from '../scene/scene-contract.js';

export interface ProjectServices {
  ownerKey: string;
  projects: ProjectRepository;
  jobs: JobRepository;
  modalAccounts?: Pick<ModalAccountManager,'status'|'test'|'disconnect'|'saveAndTest'>;
  artifacts?:Pick<LocalArtifactStore,'inspect'|'verifiedArtifactPath'>;
  viewerOrigin?:string;
  renderJobs?:Pick<RenderJobRepository,'reserve'|'get'|'list'>;
  glbPreviews?:Pick<GlbPreviewRepository,'reserve'|'get'|'latest'>;
  glbPreviewFiles?:Pick<GlbPreviewArtifactStore,'verifiedPath'>;
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
  const {ownerKey,projects,jobs,modalAccounts,artifacts,viewerOrigin,renderJobs,
    glbPreviews,glbPreviewFiles}=deps;
  const viewerLink=(projectId:string,revision:number)=>
    viewerOrigin+'/viewer/'+encodeURIComponent(projectId)+'/revisions/'+revision;
  async function ownedViewerRevision(projectId:string,revision:number):Promise<boolean>{
    if(!viewerOrigin||!artifacts)return false;
    const project=await projects.get(ownerKey,projectId);
    if(!project)return false;
    const revisions=await projects.revisions(ownerKey,projectId);
    if(!revisions.some(v=>v.revision===revision&&v.artifact_prefix))return false;
    try{
      const latest=await glbPreviews?.latest(ownerKey,projectId,revision);
      if(latest&&latest.sha256&&latest.size_bytes&&glbPreviewFiles){
        await glbPreviewFiles.verifiedPath(projectId,latest.id,latest.sha256,latest.size_bytes);
        return true;
      }
      await artifacts.verifiedArtifactPath(projectId,revision,'scene.glb');return true;
    }catch{return false;}
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
      return result({revisions:versions.map(v=>({revision:v.revision,createdAt:v.created_at,note:v.note,
        artifactAvailable:v.artifact_prefix!==null,
        ...(v.source_revision!=null?{sourceRevision:v.source_revision}:{})}))}); }
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
  // Read only previously saved, checksum-verified JSON. These calls never
  // start Blender, inspect untrusted .blend bytes, or incur Modal charges.
  server.registerTool('workspace_list_materials',{
    description:'List reusable named PBR materials (numeric colors, metallic, roughness, opacity, emission) and mesh users stored in one owned, checksum-verified Blender revision. Read only, no Modal job. Older revisions return available=false. Modifying material data is performed through Blender-Python.',
    inputSchema:{projectId:uuid,revision:z.number().int().min(1).max(99999999)},
    annotations:{readOnlyHint:true},...schemes(READ_SCOPE)
  },async({projectId,revision})=>{
    const block=denied(READ_SCOPE);if(block)return block;
    try{
      const project=await projects.get(ownerKey,projectId);
      if(!project||!artifacts)return failure(new JobConflict('Material catalog unavailable'));
      const revisions=await projects.revisions(ownerKey,projectId);
      if(!revisions.some(v=>v.revision===revision&&v.artifact_prefix))
        return failure(new JobConflict('Saved revision not found'));
      const scene=await inspectSavedScene(artifacts,projectId,revision);
      return result({projectId,revision,...materialCatalog(scene)});
    }catch{return failure(new JobConflict('Saved material catalog could not be inspected'));}
  });
  server.registerTool('workspace_inspect_geometry',{
    description:'Inspect exact saved base-mesh vertex, edge and face counts, world-space bounds, UV layers, modifiers and diagnostic counts. No Blender job, no Model execution. Historic revisions without geometry metrics return available=false, never guessed values. Optional objectId filters to one stable object identity.',
    inputSchema:{projectId:uuid,revision:z.number().int().min(1).max(99999999),
      objectId:uuid.optional()},
    annotations:{readOnlyHint:true},...schemes(READ_SCOPE)
  },async({projectId,revision,objectId})=>{
    const block=denied(READ_SCOPE);if(block)return block;
    try{
      const p=await projects.get(ownerKey,projectId);
      if(!p||!artifacts)return failure(new JobConflict('Project geometry unavailable'));
      const revisions=await projects.revisions(ownerKey,projectId);
      if(!revisions.some(v=>v.revision===revision&&v.artifact_prefix))
        return failure(new JobConflict('Saved project revision not found'));
      const scene=await inspectSavedScene(artifacts,projectId,revision);
      return result({projectId,revision,...geometrySnapshot(scene,objectId)});
    }catch{return failure(new JobConflict('Saved geometry could not be inspected'));}
  });
  server.registerTool('workspace_validate_model',{
    description:'Read non-mutating, diagnostic topology checks on an owned saved Blender revision: open boundaries, non-manifold edges, loose edges, isolated vertices and zero-area faces. Checks base meshes only, NOT manifold orientation, printable validity, evaluated modifiers or export readiness. Historic reports return incomplete. No Modal job is created.',
    inputSchema:{projectId:uuid,revision:z.number().int().min(1).max(99999999),
      objectId:uuid.optional()},
    annotations:{readOnlyHint:true},...schemes(READ_SCOPE)
  },async({projectId,revision,objectId})=>{
    const block=denied(READ_SCOPE);if(block)return block;
    try{
      const p=await projects.get(ownerKey,projectId);
      if(!p||!artifacts)return failure(new JobConflict('Model validation unavailable'));
      const revisions=await projects.revisions(ownerKey,projectId);
      if(!revisions.some(v=>v.revision===revision&&v.artifact_prefix))
        return failure(new JobConflict('Saved project revision not found'));
      const scene=await inspectSavedScene(artifacts,projectId,revision);
      return result({projectId,revision,...geometryValidation(scene,objectId)});
    }catch{return failure(new JobConflict('Model validation could not be completed'));}
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
  if(renderJobs){
    server.registerTool('workspace_queue_render',{
      description:'Explicitly queue an additional paid Modal Sandbox render of an existing saved Blender .blend revision. Does not change project revisions. Eevee/Cycles CPU, size 256/512/1024 square, samples 8/16/32, timeout at most 6 minutes. Only call when the user explicitly requests rendering.',
      inputSchema:{projectId:uuid,revision:z.number().int().min(1).max(99999999),
        engine:z.enum(['BLENDER_EEVEE_NEXT','CYCLES']).default('BLENDER_EEVEE_NEXT'),
        size:z.union([z.literal(256),z.literal(512),z.literal(1024)]).default(512),
        samples:z.union([z.literal(8),z.literal(16),z.literal(32)]).default(16)},
      ...schemes(WRITE_SCOPE)
    },async({projectId,revision,engine,size,samples})=>{
      const blocked=denied(WRITE_SCOPE);if(blocked)return blocked;
      try{
        if(!modalAccounts||!(await modalAccounts.status(ownerKey)).connected)
          return failure(new JobConflict('Connect Modal before requesting a paid render'));
        if(!artifacts)return failure(new JobConflict('Saved artifacts unavailable'));
        const project=await projects.get(ownerKey,projectId);
        if(!project)return failure(new JobConflict('Project not found'));
        const history=await projects.revisions(ownerKey,projectId);
        if(!history.some(r=>r.revision===revision&&r.artifact_prefix))
          return failure(new JobConflict('Saved revision not found'));
        await artifacts.verifiedArtifactPath(projectId,revision,'scene.blend');
        const options=validateRenderOptions({engine:engine as RenderEngine,width:size,height:size,samples});
        const job=await renderJobs.reserve(ownerKey,projectId,revision,options);
        return result({renderJobId:job.id,projectId,revision,engine,size,samples,
          status:job.status,additionalModalExecution:true,modelRevisionUnchanged:true});
      }catch{return failure(new JobConflict('Render could not be queued'));}
    });
    server.registerTool('workspace_get_render',{
      description:'Read status of an explicitly requested render job. Completed images are available through a Google-authenticated browser PNG URL. Does not start Modal.',
      inputSchema:{renderJobId:uuid},annotations:{readOnlyHint:true},...schemes(READ_SCOPE)
    },async({renderJobId})=>{
      const blocked=denied(READ_SCOPE);if(blocked)return blocked;
      try{
        const job=await renderJobs.get(ownerKey,renderJobId);
        if(!job)return failure(new JobConflict('Render not found'));
        return result({renderJobId:job.id,projectId:job.project_id,
          revision:job.source_revision,engine:job.engine,size:[job.width,job.height],
          samples:job.samples,status:job.status,
          ...(job.status==='failed'?{failure:job.error_code}:{}),
          ...(job.status==='completed'&&viewerOrigin
             ?{pngUrl:viewerOrigin+'/renders/'+job.project_id+'/'+job.id+'.png',
               requiresGoogleLogin:true}:{})});
      }catch{return failure(new JobConflict('Render status unavailable'));}
    });
  }
  if(glbPreviews&&glbPreviewFiles){
    server.registerTool('workspace_queue_glb_preview_refresh',{
      description:'Explicitly queue a paid Modal re-export of the GLB preview for an EXISTING immutable Blender revision. Uses saved native BLEND and latest material fallback. No modeling Python and no new scene revision. Only call when the user explicitly requests a preview refresh.',
      inputSchema:{projectId:uuid,revision:z.number().int().min(1).max(99999999)},
      ...schemes(WRITE_SCOPE)
    },async({projectId,revision})=>{
      const deniedResult=denied(WRITE_SCOPE);if(deniedResult)return deniedResult;
      try{
        if(!modalAccounts||!(await modalAccounts.status(ownerKey)).connected)
          return failure(new JobConflict('Connect Modal before refreshing the preview'));
        if(!artifacts)return failure(new JobConflict('Saved source unavailable'));
        const project=await projects.get(ownerKey,projectId);
        if(!project)return failure(new JobConflict('Project not found'));
        const revisions=await projects.revisions(ownerKey,projectId);
        if(!revisions.some(v=>v.revision===revision&&v.artifact_prefix))
          return failure(new JobConflict('Saved revision not found'));
        await artifacts.verifiedArtifactPath(projectId,revision,'scene.blend');
        const job=await glbPreviews.reserve(ownerKey,projectId,revision);
        return result({previewJobId:job.id,projectId,revision,status:job.status,
          additionalModalExecution:true,modelRevisionUnchanged:true});
      }catch{return failure(new JobConflict('Preview refresh could not be queued'));}
    });
    server.registerTool('workspace_get_glb_preview_refresh',{
      description:'Read status of a previously requested GLB preview refresh. Does not start a Modal job.',
      inputSchema:{previewJobId:uuid},
      annotations:{readOnlyHint:true},...schemes(READ_SCOPE)
    },async({previewJobId})=>{
      const deniedResult=denied(READ_SCOPE);if(deniedResult)return deniedResult;
      try{
        const job=await glbPreviews.get(ownerKey,previewJobId);
        if(!job)return failure(new JobConflict('Preview job not found'));
        return result({previewJobId:job.id,projectId:job.project_id,
          revision:job.source_revision,status:job.status,
          ...(job.status==='failed'?{failure:job.error_code}:{}),
          ...(job.status==='completed'&&viewerOrigin
            ?{viewerUrl:viewerLink(job.project_id,job.source_revision),
              requiresGoogleLogin:true}:{})});
      }catch{return failure(new JobConflict('Preview job unavailable'));}
    });
  }
  server.registerTool('workspace_queue_python_script',{
    description:'Validate Python syntax in the MCP service before queueing Blender Python in a short-lived, network-blocked Modal Sandbox. Optional sourceRevision lets an edit create the next immutable revision from an earlier saved revision; omit it to use the latest. Untrusted Python can use the full bpy API only inside the isolated worker; never submit secrets or external file paths. Creates a new immutable revision. The same owner checks and SHA-256 verified predecessor apply for every revision. This is the only MCP modeling-write tool. Each script is executed in a new isolated worker with resource limits; no remote assets, filesystem paths or secrets may be submitted.',
    inputSchema:{projectId:uuid,expectedRevision:z.number().int().min(0).max(99999998),
      code:PythonScriptSchema.shape.code,note:note.optional(),
      sourceRevision:z.number().int().min(1).max(99999998).optional()},...schemes(WRITE_SCOPE)
  },async({projectId,expectedRevision,code,note:jobNote,sourceRevision})=>{
    const blocked=denied(WRITE_SCOPE);if(blocked)return blocked;
    try{
      // Syntax errors are actionable and never reserve a job or start Modal.
      await preflightPython(code);
      if(!modalAccounts||!(await modalAccounts.status(ownerKey)).connected)
        return failure(new JobConflict('Connect your Modal account before queueing Python'));
      if(!artifacts)return failure(new JobConflict('Scene artifacts are not configured'));
      const project=await projects.get(ownerKey,projectId);
      if(!project)return failure(new JobConflict('Project not found'));
      if(project.current_revision!==expectedRevision)
        return failure(new JobConflict('Stale project revision'));
      if(sourceRevision!==undefined && (!Number.isSafeInteger(sourceRevision)||
         sourceRevision<1||expectedRevision===0||sourceRevision>expectedRevision))
        return failure(new JobConflict('Invalid historical source revision'));
      const selectedSource=expectedRevision===0?0:(sourceRevision??expectedRevision);
      if(selectedSource>0){
        const history=await projects.revisions(ownerKey,projectId);
        if(!history.some(v=>v.revision===selectedSource&&v.artifact_prefix))
          return failure(new JobConflict('Saved source revision not found'));
        await artifacts.verifiedArtifactPath(projectId,selectedSource,'scene.blend');
      }
      const spec=PythonScriptSchema.parse({kind:'python_script',code});
      const job=await jobs.reserve(ownerKey,projectId,expectedRevision,
        jobNote??'Sandboxed Blender Python',undefined,spec,sourceRevision);
      return result({job:safeJob(job),execution:'modal-sandbox',
        ...(selectedSource>0?{sourceRevision:selectedSource}:{}),
        message:'Queued Blender Python for isolated execution; one immutable scene revision'});
    }catch(error){
      if(error instanceof PythonSyntaxError)
        return failure(new JobConflict(error.message));
      // Fail closed on missing interpreter/timeouts rather than bill Modal.
      if(error instanceof Error && error.message.startsWith('Python syntax preflight'))
        return failure(new JobConflict(error.message));
      return failure(new JobConflict('Python job could not be queued'));
    }
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
      const diagnostic=(j.status==='failed'||j.status==='needs_recovery')
        ?safeOwnerJobError(j.error_message):null;
      return result({job,...(diagnostic?{failure:diagnostic}:{})});
    } catch(e){return failure(e);}
  });
}
