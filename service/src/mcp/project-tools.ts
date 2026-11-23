import { z } from 'zod';
import {readFile,stat} from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ProjectRepository } from '../db/projects.js';
import {JobConflict,type JobRepository} from '../jobs/job-repository.js';
import {safeOwnerJobError} from '../jobs/job-diagnostics.js';
import {READ_SCOPE,WRITE_SCOPE} from '../auth/oauth.js';
import {MODAL_MEMORY_CHOICES_MIB,type ModalAccountManager} from '../modal/modal-accounts.js';
import {PythonScriptSchema} from '../jobs/python-script.js';
import {preflightPython,PythonSyntaxError} from '../jobs/python-preflight.js';
import {AssetSourcesSchema,parseAssetSources} from '../jobs/asset-sources.js';
import type {UploadedAssets} from '../jobs/uploaded-assets.js';
import {NativeTextureDownloader,decodeTextureBase64} from './texture-file-transfer.js';
import type {LocalArtifactStore} from '../storage/artifact-store.js';
import type {RenderArtifactStore} from '../storage/render-artifacts.js';
import type {GlbPreviewRepository} from '../jobs/glb-preview-repository.js';
import type {ProjectCloneService} from '../jobs/project-clone.js';
import type {GlbPreviewArtifactStore} from '../storage/glb-preview-artifacts.js';
import {validateRenderOptions,type RenderJobRepository,type RenderEngine} from '../jobs/render-repository.js';
import {inspectSavedScene,inspectSavedPerformance,geometrySnapshot,geometryValidation,materialCatalog} from '../scene/scene-contract.js';

export interface ProjectServices {
  ownerKey: string;
  projects: ProjectRepository;
  jobs: JobRepository;
  modalAccounts?: Pick<ModalAccountManager,'status'|'test'|'disconnect'|'saveAndTest'|'memoryMiB'|'setMemoryMiB'>;
  artifacts?:Pick<LocalArtifactStore,'inspect'|'verifiedArtifactPath'> & Partial<Pick<LocalArtifactStore,'readVerifiedSmallArtifact'>>;
  projectClone?:Pick<ProjectCloneService,'clone'>;
  uploads?:Pick<UploadedAssets,'list'|'get'|'verifiedPath'> & Partial<Pick<UploadedAssets,'upload'>>;
  viewerOrigin?:string;
  renderJobs?:Pick<RenderJobRepository,'reserve'|'get'|'list'>;
  renderedImages?:Pick<RenderArtifactStore,'verifiedPath'>;
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
  const {ownerKey,projects,jobs,modalAccounts,artifacts,viewerOrigin,renderJobs,renderedImages,
    glbPreviews,glbPreviewFiles,projectClone,uploads}=deps;
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

  if(uploads?.upload){
    const nativeFile=z.object({
      download_url:z.string().url().max(4096),
      file_id:z.string().min(1).max(512),
      mime_type:z.string().max(128).optional(),
      file_name:z.string().min(1).max(255).optional()
    }).strict();
    server.registerTool('workspace_upload_texture',{
      title:'Upload image texture',
      description:'Upload a PNG/JPEG texture as a private file, without starting Modal. Prefer the ChatGPT native file parameter (file_id and download_url); use textureBase64 only for small MCP clients without native file inputs. Returns an uploadId for assetSources {uploadId,texture:{objectName,channel}} in workspace_queue_python_script.',
      inputSchema:{
        file:nativeFile.optional().describe('Native file parameter supplied by the MCP client; download_url is short-lived and fetched by the server.'),
        filename:z.string().min(1).max(200).optional().describe('PNG/JPG/JPEG filename; defaults to file.file_name when provided.'),
        textureBase64:z.string().min(1).max(240000).optional().describe('Small-file fallback only (about 180 KiB); larger images must use native file input.')
      },...schemes(WRITE_SCOPE)
    },async({file,filename,textureBase64})=>{
      const block=denied(WRITE_SCOPE);if(block)return block;
      if(Boolean(file)===Boolean(textureBase64))
        return {isError:true,content:[{type:'text' as const,
          text:'Provide exactly one of file or textureBase64'}]};
      const name=filename??file?.file_name;
      if(!name||!/^[^/\\\0-\x1f\x7f]+\.(?:png|jpe?g)$/i.test(name))
        return {isError:true,content:[{type:'text' as const,
          text:'A PNG or JPEG filename is required'}]};
      try{
        const bytes=file?await new NativeTextureDownloader().download(file):
          decodeTextureBase64(textureBase64!);
        const saved=await uploads.upload!(ownerKey,name,bytes);
        if(!['png','jpg'].includes(saved.format))
          throw new Error('Unexpected asset category');
        return result({uploadId:saved.id,filename:saved.filename,
          format:saved.format,sizeBytes:saved.size_bytes,modalExecution:false});
      }catch{
        // Never return signed file URLs, private paths or upstream error bodies.
        return {isError:true,content:[{type:'text' as const,
          text:'Texture upload failed. Check PNG/JPEG file type, max 32 MiB, expiry and public HTTPS file link.'}]};
      }
    });
  }
  if(uploads){
    server.registerTool('workspace_list_uploaded_models',{
      description:'List verified BLEND, GLB, PNG and JPEG files uploaded by your account. Use BLEND/GLB as model assetSources; for PNG/JPEG use assetSources {uploadId,texture:{objectName,channel}} to apply an image to a named mesh PBR channel.',
      inputSchema:{limit:z.number().int().min(1).max(100).optional()},
      annotations:{readOnlyHint:true},...schemes(READ_SCOPE)
    },async({limit})=>{
      const block=denied(READ_SCOPE);if(block)return block;
      try{
        const files=await uploads.list(ownerKey,limit??40);
        return result({uploads:files.map(f=>({id:f.id,filename:f.filename,
          format:f.format,sizeBytes:f.size_bytes,createdAt:f.created_at}))});
      }catch(e){return failure(e);}
    });
  }
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
  if(projectClone){
    server.registerTool('workspace_clone_project_from_revision',{
      description:'Create an independent new project from a saved BLEND revision belonging to your account. Copies checksum-verified original files without Blender or Modal, preserving source intact.',
      inputSchema:{sourceProjectId:uuid,sourceRevision:z.number().int().min(1).max(99999999),
        name:cleanName,description:cleanDescription.optional()},...schemes(WRITE_SCOPE)
    },async({sourceProjectId,sourceRevision,name,description})=>{
      const block=denied(WRITE_SCOPE);if(block)return block;
      try{
        const project=await projectClone.clone(ownerKey,sourceProjectId,sourceRevision,name,description??'');
        return result({project:safeProject(project),
          clonedFrom:{projectId:sourceProjectId,revision:sourceRevision},
          newRevision:1,modalExecution:false});
      }catch(e){return failure(e);}
    });
  }
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
        ...(v.source_revision!=null?{sourceRevision:v.source_revision}:{}),
        ...(v.source_project_id&&v.source_project_revision?{
          clonedFrom:{projectId:v.source_project_id,revision:v.source_project_revision}}:{})}))}); }
    catch(e){return failure(e);}
  });
  server.registerTool('workspace_inspect_scene',{
    description:'Read saved object metadata, including bounded stored geometry/hair complexity and modifier hints when present. Generated Geometry Nodes/child hair counts are unknown; no dependency graph evaluation. Read-only; does not execute Blender.',
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
    description:'Inspect saved base-mesh topology plus stored object complexity (hair curves/points and modifier/procedural hints). Never evaluates Geometry Nodes or child hair. Legacy reports mark complexity unavailable rather than guessing. No Blender/Modal job. Optional objectId filters one stable object ID.',
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
  if(renderJobs&&renderedImages){
    server.registerTool('workspace_get_render_image',{
      description:'Return the actual PNG pixels of one completed, owner-owned Blender rendering as an MCP image for visual inspection. Includes inline and separately queued renders from the same gallery. Read-only and does not start Modal or Blender. PNG must be at most 1024×1024 and 4 MiB; for larger renders use the existing browser gallery.',
      inputSchema:{renderJobId:uuid},
      annotations:{readOnlyHint:true},...schemes(READ_SCOPE)
    },async({renderJobId})=>{
      const blocked=denied(READ_SCOPE);if(blocked)return blocked;
      try{
        const job=await renderJobs.get(ownerKey,renderJobId);
        if(!job||job.status!=='completed'||!job.sha256||!job.size_bytes)
          return failure(new JobConflict('Completed rendering not found'));
        if(job.width<1||job.height<1||job.width>1024||job.height>1024||
           job.size_bytes>4*1024*1024)
          return failure(new JobConflict('Rendering exceeds MCP image limits; use browser gallery'));
        // The store validates checksum, length and regular-file status before
        // returning the path; never access arbitrary files or image URLs.
        const filename=await renderedImages.verifiedPath(
          job.project_id,job.id,job.sha256,job.size_bytes);
        const fileInfo=await stat(filename);
        if(fileInfo.size!==job.size_bytes||fileInfo.size>4*1024*1024)
          return failure(new JobConflict('Rendering exceeds MCP image limits; use browser gallery'));
        const bytes=await readFile(filename);
        if(bytes.length!==job.size_bytes||
           !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
           bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)!==job.width||
           bytes.readUInt32BE(20)!==job.height)
          return failure(new JobConflict('Verified render metadata mismatch'));
        return {content:[
          {type:'text' as const,text:JSON.stringify({
            renderJobId:job.id,projectId:job.project_id,revision:job.source_revision,
            engine:job.engine,width:job.width,height:job.height,samples:job.samples,
            bytes:bytes.length,modalExecution:false
          })},
          {type:'image' as const,data:bytes.toString('base64'),mimeType:'image/png'}
        ]};
      }catch{return failure(new JobConflict('Rendering could not be read securely'));}
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
    description:'Validate Python syntax in the MCP service before queueing Blender Python in a short-lived, network-blocked Modal Sandbox. Optional sourceRevision lets an edit create the next immutable revision from an earlier saved revision; omit it to use the latest. Untrusted Python can use the full bpy API only inside the isolated worker; never submit secrets or external file paths. Creates a new immutable revision. The same owner checks and SHA-256 verified predecessor apply for every revision. An optional inlineRender:true generates a 512x512 Cycles image with 16 samples during the same Blender process at additional billable runtime, and never affects the native BLEND if it fails. This is the only MCP modeling-write tool. Each script is executed in a new isolated worker with resource limits; no remote assets, filesystem paths or secrets may be submitted.',
    inputSchema:{projectId:uuid,expectedRevision:z.number().int().min(0).max(99999998),
      code:PythonScriptSchema.shape.code,note:note.optional(),
      inlineRender:z.boolean().optional(),
      sourceRevision:z.number().int().min(1).max(99999998).optional(),
      assetSources:AssetSourcesSchema.optional()},...schemes(WRITE_SCOPE)
  },async({projectId,expectedRevision,code,note:jobNote,sourceRevision,assetSources,inlineRender})=>{
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
      const inputs=parseAssetSources(assetSources);
      for(const asset of inputs){
        if('uploadId' in asset){
          if(!uploads)return failure(new JobConflict('File import unavailable'));
          await uploads.verifiedPath(ownerKey,asset.uploadId);
        }else{
          const sourceProject=await projects.get(ownerKey,asset.projectId);
          if(!sourceProject)return failure(new JobConflict('Model source unavailable'));
          const versions=await projects.revisions(ownerKey,asset.projectId);
          if(!versions.some(v=>v.revision===asset.revision&&v.artifact_prefix))
            return failure(new JobConflict('Model source revision unavailable'));
          await artifacts.verifiedArtifactPath(asset.projectId,asset.revision,'scene.blend');
        }
      }
      const spec=PythonScriptSchema.parse({kind:'python_script',code,...(inlineRender?{inlineRender:true}:{})});
      const job=await jobs.reserve(ownerKey,projectId,expectedRevision,
        jobNote??'Sandboxed Blender Python',undefined,spec,sourceRevision,inputs);
      return result({job:safeJob(job),execution:'modal-sandbox',
        ...(selectedSource>0?{sourceRevision:selectedSource}:{}),
        ...(inputs.length?{assetSources:inputs}:{}),
        ...(inlineRender?{inlineRenderRequested:true}:{}),
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
    server.registerTool('workspace_get_modal_memory',{
      description:'Read your own reserved memory for future paid Modal Sandbox jobs (2, 4, 8 or 16 GiB). No Modal job or charge.',
      inputSchema:{},annotations:{readOnlyHint:true},...schemes(READ_SCOPE)
    },async()=>{
      const blocked=denied(READ_SCOPE);if(blocked)return blocked;
      try{return result({memoryMiB:await modalAccounts.memoryMiB(ownerKey),
        choicesMiB:[...MODAL_MEMORY_CHOICES_MIB],appliesTo:'future-jobs',modalExecution:false});}
      catch{return failure(new Error('Modal memory settings unavailable'));}
    });
    server.registerTool('workspace_set_modal_memory',{
      description:'Set your own future Modal Sandbox memory reservation to 2, 4, 8 or 16 GiB. Does not start a Modal job. Higher reservations can cost more.',
      inputSchema:{memoryMiB:z.union([z.literal(2048),z.literal(4096),z.literal(8192),z.literal(16384)])},
      ...schemes(WRITE_SCOPE)
    },async({memoryMiB})=>{
      const blocked=denied(WRITE_SCOPE);if(blocked)return blocked;
      try{
        await modalAccounts.setMemoryMiB(ownerKey,memoryMiB);
        return result({memoryMiB,appliesTo:'future-jobs',modalExecution:false});
      }catch{return failure(new Error('Modal memory setting could not be updated'));}
    });
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
      let performance=null;
      if(j.status==='completed'&&artifacts){
        try{performance=await inspectSavedPerformance(artifacts,j.project_id,j.requested_revision);}
        catch{/* Previous or missing reports never block job status. */}
      }
      const viewerAvailable=j.status==='completed'&&await ownedViewerRevision(
        j.project_id,j.requested_revision);
      const diagnostic=(j.status==='failed'||j.status==='needs_recovery')
        ?safeOwnerJobError(j.error_message):null;
      const registeredRender=j.status==='completed'&&renderJobs
        ?await renderJobs.get(ownerKey,j.id):null;
      return result({job,
        ...(viewerAvailable?{viewerUrl:viewerLink(j.project_id,j.requested_revision),
          requiresGoogleLogin:true}:{}),
        ...(performance?{performance}:{}),
        ...(registeredRender?.status==='completed'&&registeredRender.sha256&&viewerOrigin
          ?{renderPngUrl:viewerOrigin+'/renders/'+j.project_id+'/'+j.id+'.png',
            requiresGoogleLogin:true}:{}),
        ...(diagnostic?{failure:diagnostic}:{})});
    } catch(e){return failure(e);}
  });
}
