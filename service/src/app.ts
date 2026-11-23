import Fastify from 'fastify';
import {createReadStream} from 'node:fs';
import {rm} from 'node:fs/promises';
import type {ProjectArchiveService} from './jobs/project-archive.js';
import type {ProjectCloneService} from './jobs/project-clone.js';
import type {UploadedAssets} from './jobs/uploaded-assets.js';
import {MAX_UPLOAD_BYTES} from './storage/uploaded-assets.js';
import {modelUploadScript} from './web/model-upload-client.js';
import {validateRenderOptions,type RenderJobRepository,type RenderEngine} from './jobs/render-repository.js';
import {validateViewerCamera,viewerDimensions} from './jobs/viewer-camera.js';
import type {RenderArtifactStore} from './storage/render-artifacts.js';
import {MODAL_MEMORY_CHOICES_MIB} from './modal/modal-accounts.js';
import type {GlbPreviewRepository} from './jobs/glb-preview-repository.js';
import type {GlbPreviewArtifactStore} from './storage/glb-preview-artifacts.js';
import {importClientScript} from './web/import-client.js';
import {liveStatusScript} from './web/live-status.js';
import {fileURLToPath} from 'node:url';
import {viewerPage} from './viewer-page.js';
import type {ProjectDeletionService} from './jobs/project-deletion.js';
import {projectIndexPage,projectImportPage,modelImportPage,projectDetailPage,projectDeletePage,jobsOverviewPage,type PortalJobItem} from './web/project-pages.js';
import {safeOwnerJobError,describeJobFailure} from './jobs/job-diagnostics.js';
import {blendDownloadFilename,portableResourceInfo} from './web/blend-download.js';
import type {PublicShareRepository} from './jobs/public-shares.js';
import {validShareToken} from './jobs/public-shares.js';
import {publicSharePage,ownerSharePage} from './web/public-share-page.js';
import {McpServer} from '@modelcontextprotocol/server';
import {GoogleOAuthServer} from './auth/google-server.js';
import {NodeStreamableHTTPServerTransport} from '@modelcontextprotocol/node';
import {authorized,type ServiceConfig} from './config.js';
import {registerProjectTools,type ProjectServices} from './mcp/project-tools.js';
import {bearerChallenge,protectedResourceMetadata,remoteJwks,verifyOAuthAccessToken,
 READ_SCOPE,WRITE_SCOPE,type Principal,type Jwks} from './auth/oauth.js';

export function createApp(config:ServiceConfig,
 services?: {ownerKey?:string;projects:ProjectServices['projects'];jobs:ProjectServices['jobs'];
  modalAccounts?:ProjectServices['modalAccounts'];artifacts?:ProjectServices['artifacts'];
  projectDeletion?:Pick<ProjectDeletionService,'delete'>;
  projectArchive?:Pick<ProjectArchiveService,'export'|'import'>;
   projectClone?:Pick<ProjectCloneService,'clone'>;
  uploads?:Pick<UploadedAssets,'upload'|'list'|'get'|'verifiedPath'>;
  publicShares?:Pick<PublicShareRepository,'create'|'owned'|'revoke'|'resolve'|'setSelectedRenders'>;
  renderJobs?:Pick<RenderJobRepository,'reserve'|'list'|'listForOwner'|'recentCompletedByProjects'|'get'>;
  renderedImages?:Pick<RenderArtifactStore,'verifiedPath'>;
  glbPreviews?:Pick<GlbPreviewRepository,'latest'|'get'|'reserve'>;
  glbPreviewFiles?:Pick<GlbPreviewArtifactStore,'verifiedPath'>},
 options?: {keys?:Jwks;google?:GoogleOAuthServer}) {
 if(config.authMode!=='internal'&&!services)throw new Error('OAuth requires project services');
 if(config.authMode==='internal'&&services&&(!config.ownerKey||services.ownerKey!==config.ownerKey))
   throw new Error('Internal owner identity mismatch');
 const app=Fastify({logger:{level:'info'},disableRequestLogging:true,bodyLimit:256*1024,trustProxy:false});
 async function activeGlb(owner:string,projectId:string,revision:number):Promise<string>{
   const latest=await services?.glbPreviews?.latest(owner,projectId,revision);
   if(latest&&latest.sha256&&latest.size_bytes&&services?.glbPreviewFiles){
     // Never silently fall back to a stale GLB when latest derived bytes are corrupt.
     return services.glbPreviewFiles.verifiedPath(projectId,latest.id,latest.sha256,latest.size_bytes);
   }
   if(!services?.artifacts)throw new Error('GLB unavailable');
   return services.artifacts.verifiedArtifactPath(projectId,revision,'scene.glb');
 }

 const principals=new WeakMap<object,Principal>();
 const keys=config.oauth?(options?.keys??options?.google?.verifierKeys??remoteJwks(config.oauth)):undefined;
 if(config.google&&!options?.google)throw new Error('Google OAuth mode requires an authorization server');

 if(config.oauth){
   app.get('/.well-known/oauth-protected-resource',async()=>protectedResourceMetadata(config.oauth!));
   app.get('/.well-known/oauth-protected-resource/mcp',
     async()=>protectedResourceMetadata(config.oauth!));
 }
 if(options?.google){
   app.addContentTypeParser('application/vnd.blender-workspace.project+zip',
     {parseAs:'buffer',bodyLimit:256*1024*1024},(_request,body,done)=>done(null,body));
   app.addContentTypeParser('application/vnd.blender-workspace.model',
     {parseAs:'buffer',bodyLimit:MAX_UPLOAD_BYTES},(_request,body,done)=>done(null,body));
   app.addContentTypeParser('application/x-www-form-urlencoded',
     {parseAs:'string'},(_request,body,done)=>done(null,body));
   const google=options.google;
   // Account settings are only available after an independent Google browser login.
   // MCP bearer tokens are never passed into the browser or stored in its cookies.
   if(services?.modalAccounts){
     const accounts=services.modalAccounts;
     const secure=(reply:any)=>{
       reply.header('cache-control','no-store')
         .header('content-security-policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
         .header('x-content-type-options','nosniff')
         .header('referrer-policy','no-referrer');
       return reply;
     };
     const escape=(v:string)=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;')
       .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
     const page=(csrf:string,status:string,message:string,memoryMiB:number)=>`<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blender Workspace – Modal</title>
<style>body{font-family:system-ui,sans-serif;max-width:660px;margin:48px auto;padding:0 20px}
section{border:1px solid #bbb;border-radius:12px;padding:20px}
label{display:block;margin-top:12px}input{box-sizing:border-box;width:100%;padding:12px}
button{padding:10px 16px;margin:12px 8px 0 0}</style></head><body>
<section><p><a href="/">← Mina projekt</a></p><h1>Modal – Blender Workspace</h1><p>Kontostatus: ${escape(status)}</p>
<p>${escape(message)}</p><p>Dina Modal-uppgifter lagras krypterat och visas aldrig i ChatGPT.</p>
<section style="margin:16px 0;padding:14px;border:1px solid #ddd;border-radius:10px">
<h2>Reserverat minne per Sandbox</h2>
<p>Gäller dina framtida modellerings-, renderings- och GLB-jobb i Modal. Standard: 2 GiB. Högre värden kan öka kostnaden; välj mer vid stora scener. Modal kan använda mer än reservationen när kapacitet finns, men det är inte garanterat.</p>
<form method="post" action="/settings/modal/memory">
<input type="hidden" name="csrf" value="${escape(csrf)}">
<label for="memoryMiB">Reserverat minne
<select id="memoryMiB" name="memoryMiB">
${MODAL_MEMORY_CHOICES_MIB.map(n=>'<option value="'+n+'"'+(n===memoryMiB?' selected':'')+'>'+(n/1024)+' GiB</option>').join('')}
</select></label>
<button type="submit">Spara minnesval</button>
</form></section>
<form method="post" action="/settings/modal/save">
<input type="hidden" name="csrf" value="${escape(csrf)}">
<label>Modal Token ID<input name="tokenId" autocomplete="off" required maxlength="500"></label>
<label>Modal Token Secret<input name="tokenSecret" type="password" autocomplete="off" required maxlength="1000"></label>
<button type="submit">Anslut eller ersätt</button></form>
<form method="post" action="/settings/modal/test"><input type="hidden" name="csrf" value="${escape(csrf)}"><button>Testa anslutning</button></form>
<form method="post" action="/settings/modal/disconnect"><input type="hidden" name="csrf" value="${escape(csrf)}"><button>Koppla bort</button></form>
<form method="post" action="/settings/logout"><input type="hidden" name="csrf" value="${escape(csrf)}"><button>Logga ut</button></form>
</section></body></html>`;
     app.get('/',async(request,reply)=>{
       const session=google.settingsSession(request.headers.cookie);
       secure(reply).header('vary','Cookie').type('text/html; charset=utf-8');
       if(!session)return '<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Blender Workspace</title><style>body{font:16px system-ui,sans-serif;background:#f4f7fb;color:#19263b;display:grid;place-items:center;min-height:90vh;margin:0;padding:24px}main{background:white;padding:32px;border-radius:14px;border:1px solid #d8e2ed;max-width:480px}a{display:inline-block;background:#215dd5;color:white;text-decoration:none;padding:12px 18px;border-radius:9px}</style></head><body><main><h1>Blender Workspace</h1><p>Logga in med Google för att visa dina projekt och sparade 3D-modeller.</p><a href="/settings/login">Logga in med Google</a></main></body></html>';
       try{
         // Bound the number of owner-scoped queries on each request.
         const projects=await services!.projects.list(session.ownerKey,50);
         const recentRenders=await services!.renderJobs?.recentCompletedByProjects?.(
           session.ownerKey,projects.map(p=>p.id),3)??[];
         const items=await Promise.all(projects.map(async project=>{
           const revisions=await services!.projects.revisions(session.ownerKey,project.id);
           const last=revisions.at(-1);
           if(last?.artifact_prefix&&services!.artifacts){
             try{
               const manifest=await services!.artifacts.inspect(project.id,last.revision,false);
               return {project,renders:recentRenders.filter(r=>r.project_id===project.id),
                 revisions:revisions.map(r=>r.revision===last.revision
                   ?{...r,glbAvailable:manifest.artifacts.some(a=>a.name==='scene.glb')}:r)};
             }catch{/* Display native-only on broken/legacy preview manifests. */}
           }
           return {project,renders:recentRenders.filter(r=>r.project_id===project.id),revisions:revisions.map(r=>({...r,glbAvailable:false,pngAvailable:false}))};
         }));
         const message=(request.query as {message?:string}).message;
         reply.header('content-security-policy',"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
         return projectIndexPage(items,message,session.csrf);
       }catch{return reply.code(503).send('Projektlistan kunde inte hämtas. Försök igen senare.');}
     });
     // Owner-only combined modeling/render history. No Python source or browser token is embedded.
     app.get('/jobs',async(request,reply)=>{
       const session=google.settingsSession(request.headers.cookie);
       secure(reply).header('vary','Cookie').type('text/html; charset=utf-8');
       if(!session)return reply.redirect('/settings/login');
       try{
         const [models,renders,projects]=await Promise.all([
           services!.jobs.list?.(session.ownerKey,undefined,50)??Promise.resolve([]),
           services!.renderJobs?.listForOwner?.(session.ownerKey,50)??Promise.resolve([]),
           services!.projects.list(session.ownerKey,100)
         ]);
         const names=new Map(projects.map(p=>[p.id,p.name]));
         const entries:PortalJobItem[]=[
           ...models.map(j=>({id:j.id,project_id:j.project_id,
             project_name:names.get(j.project_id)??'Projekt',type:'model' as const,
             revision:j.requested_revision,status:j.status,created_at:j.created_at,
             detail:j.note||'Blender Python',error:describeJobFailure(safeOwnerJobError(j.error_message))})),
           ...renders.map(r=>({id:r.id,project_id:r.project_id,
             project_name:names.get(r.project_id)??'Projekt',type:'render' as const,
             revision:r.source_revision,status:r.status,created_at:r.created_at,
             detail:(r.engine==='CYCLES'?'Cycles':'Eevee')+' · '+r.width+' × '+r.height+
               ' · '+r.samples+' samples',error:r.error_code}))
         ].sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime());
         reply.header('content-security-policy',
           "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
         return jobsOverviewPage(entries);
       }catch{return reply.code(503).send('Jobblistan kunde inte hämtas. Försök igen senare.');}
     });

     app.get('/models/import',async(request,reply)=>{
       const session=google.settingsSession(request.headers.cookie);
       secure(reply).header('vary','Cookie').type('text/html; charset=utf-8');
       if(!session)return reply.redirect('/settings/login');
       if(!services!.uploads)return reply.code(503).send('Filimport är inte tillgänglig');
       try{
         const [uploads,projects]=await Promise.all([
           services!.uploads.list(session.ownerKey,40),
           services!.projects.list(session.ownerKey,100)]);
         reply.header('content-security-policy',
           "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
         return modelImportPage(session.csrf,uploads,projects,
           (request.query as {message?:string}).message);
       }catch{return reply.code(503).send('Kunde inte visa uppladdade modeller.');}
     });
     app.get('/models/assets/upload.js',async(_request,reply)=>
       secure(reply).header('content-security-policy',"default-src 'none'")
         .type('application/javascript; charset=utf-8').send(modelUploadScript));
     app.post('/models/uploads',{bodyLimit:MAX_UPLOAD_BYTES},async(request,reply)=>{
       const session=google.settingsSession(request.headers.cookie);
       secure(reply).header('vary','Cookie');
       if(!session)return reply.code(401).send({error:'unauthorized'});
       const origin=request.headers.origin;
       const safari=origin==='null'&&request.headers['sec-fetch-site']==='same-origin';
       if((origin!==config.publicOrigin&&!safari)||request.headers['x-csrf-token']!==session.csrf)
         return reply.code(403).send({error:'forbidden'});
       if(request.headers['content-type']!=='application/vnd.blender-workspace.model')
         return reply.code(415).send({error:'unsupported_media_type'});
       if(!services!.uploads)return reply.code(503).send({error:'uploads_unavailable'});
       try{
         const raw=request.headers['x-model-filename'];
         if(typeof raw!=='string'||raw.length>600)
           return reply.code(400).send({error:'invalid_filename'});
         const filename=decodeURIComponent(raw);
         const uploaded=await services!.uploads.upload(session.ownerKey,filename,request.body as Buffer);
         return reply.code(201).send({uploadId:uploaded.id,format:uploaded.format});
       }catch(error){
         // Give actionable client feedback without exposing internal paths or
         // SQL/provider errors. Never trust or echo arbitrary exception text.
         if(error instanceof RangeError){
           const reason=error.message;
           const code=reason==='Unrecognized BLEND header'?'invalid_blend_format':
             reason==='Invalid PNG texture'||reason==='Invalid JPEG texture'||
             reason==='Invalid texture dimensions'?'invalid_texture':
             reason==='Upload library limit reached'?'library_full':
             reason==='Invalid upload filename'?'invalid_filename':
             reason==='Upload must be 20 bytes to 32 MiB'?'invalid_size':'invalid_model';
           return reply.code(422).send({error:code});
         }
         return reply.code(422).send({error:'invalid_model'});
       }
     });
     // Uploading never starts a job. A separate, confirmed request reserves
     // one owner-paid Modal import job and creates the next immutable revision.
     app.post('/models/compose',{bodyLimit:4096},async(request,reply)=>{
       const session=google.settingsSession(request.headers.cookie);
       secure(reply).header('vary','Cookie');
       if(!session)return reply.code(401).send('Unauthorized');
       const origin=request.headers.origin;
       const safari=origin==='null'&&request.headers['sec-fetch-site']==='same-origin';
       if(origin!==config.publicOrigin&&!safari)return reply.code(403).send('Forbidden');
       if(!(request.headers['content-type']??'').startsWith('application/x-www-form-urlencoded'))
         return reply.code(415).send('Unsupported Media Type');
       const form=new URLSearchParams(typeof request.body==='string'?request.body:'');
       if(form.get('csrf')!==session.csrf)return reply.code(403).send('Forbidden');
       if(form.get('confirm')!=='yes')return reply.code(400).send('Kostnadsbekräftelse saknas');
       if(!services!.uploads||!services!.modalAccounts)return reply.code(503).send('Importtjänsten saknas');
       const uploadId=form.get('uploadId')??'';
       if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(uploadId))
         return reply.code(400).send('Ogiltigt modell-ID');
       try{
         if(!(await services!.modalAccounts.status(session.ownerKey)).connected)
           return reply.code(409).send('Anslut Modal innan du startar importen');
         await services!.uploads.verifiedPath(session.ownerKey,uploadId);
         const destination=form.get('projectId')??'new';
         let project;
         if(destination==='new'){
           const name=form.get('name')??'';
           if(!name.trim()||name.length>200)return reply.code(400).send('Ogiltigt projektnamn');
           project=await services!.projects.create(session.ownerKey,name.trim());
         }else{
           if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(destination))
             return reply.code(404).send('Projektet hittades inte');
           project=await services!.projects.get(session.ownerKey,destination);
           if(!project)return reply.code(404).send('Projektet hittades inte');
         }
         await services!.jobs.reserve(session.ownerKey,project.id,project.current_revision,
           'Importera extern BLEND/GLB',undefined,{kind:'python_script',code:'pass'},
           undefined,[{uploadId,offset:[0,0,0]}]);
         return reply.code(303).header('location',
           '/projects/'+project.id+'?message=import_queued').send();
       }catch{return reply.code(303).header('location','/models/import?message=error').send();}
     });
     // Applying a private image is an explicit owner-paid modeling job. The
     // worker validates the stored checksum again immediately before billing.
     app.post('/models/textures/apply',{bodyLimit:4096},async(request,reply)=>{
       const session=google.settingsSession(request.headers.cookie);
       secure(reply).header('vary','Cookie');
       if(!session)return reply.code(401).send('Unauthorized');
       const origin=request.headers.origin;
       const safari=origin==='null'&&request.headers['sec-fetch-site']==='same-origin';
       if(origin!==config.publicOrigin&&!safari)return reply.code(403).send('Forbidden');
       if(!(request.headers['content-type']??'').startsWith('application/x-www-form-urlencoded'))
         return reply.code(415).send('Unsupported Media Type');
       const form=new URLSearchParams(typeof request.body==='string'?request.body:'');
       if(form.get('csrf')!==session.csrf)return reply.code(403).send('Forbidden');
       if(form.get('confirm')!=='yes')return reply.code(400).send('Kostnadsbekräftelse saknas');
       if(!services!.uploads||!services!.modalAccounts)
         return reply.code(503).send('Texturtjänsten saknas');
       const id=form.get('projectId')??'',uploadId=form.get('uploadId')??'';
       const objectName=(form.get('objectName')??'').trim(),channel=form.get('channel')??'';
       const uid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
       if(!uid.test(id)||!uid.test(uploadId)||!objectName||objectName.length>200||
          !['baseColor','roughness','metallic','normal'].includes(channel))
         return reply.code(400).send('Ogiltig texturkoppling');
       try{
         const [project,asset,account]=await Promise.all([
           services!.projects.get(session.ownerKey,id),
           services!.uploads.get(session.ownerKey,uploadId),
           services!.modalAccounts.status(session.ownerKey)]);
         if(!project||!asset||!['png','jpg'].includes(asset.format))
           return reply.code(404).send('Projekt eller bildtextur hittades inte');
         if(!account.connected)return reply.code(409).send('Anslut Modal i Inställningar');
         if(project.current_revision<1)return reply.code(409).send('Modellen saknar revision');
         await services!.jobs.reserve(session.ownerKey,id,project.current_revision,
           'Applicera bildtextur på '+objectName,undefined,{kind:'python_script',code:'pass'},
           undefined,[{uploadId,texture:{objectName,
             channel:channel as 'baseColor'|'roughness'|'metallic'|'normal'}}]);
         return reply.code(303).header('location',
           '/projects/'+id+'?view=history&message=texture_queued').send();
       }catch{return reply.code(303).header('location','/models/import?message=error').send();}
     });
     // Dedicated secondary import workflow: the project list stays the first content on mobile.
     app.get('/projects/import',async(request,reply)=>{
       const session=google.settingsSession(request.headers.cookie);
       secure(reply).header('vary','Cookie').type('text/html; charset=utf-8');
       if(!session)return reply.redirect('/settings/login');
       reply.header('content-security-policy',
         "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
       return projectImportPage(session.csrf);
     });
     // Share management never responds to unauthenticated callers. Only
     // the owner can publish/revoke, with exact revision ownership and CSRF.
     app.get('/projects/:projectId/revisions/:revision/share',async(request,reply)=>{
       const session=google.settingsSession(request.headers.cookie);
       secure(reply).header('vary','Cookie').header('cache-control','private, no-store')
         .header('referrer-policy','no-referrer').type('text/html; charset=utf-8');
       if(!session)return reply.redirect('/settings/login');
       const {projectId,revision}=request.params as {projectId:string;revision:string};
       const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
       if(!uuid.test(projectId)||!/^[1-9][0-9]{0,7}$/.test(revision)||!services!.publicShares)
         return reply.code(404).send('Revisionen hittades inte');
       try{
         const project=await services!.projects.get(session.ownerKey,projectId);
         const revisions=await services!.projects.revisions(session.ownerKey,projectId);
         if(!project||!revisions.some(r=>r.revision===Number(revision)&&r.artifact_prefix))
           return reply.code(404).send('Revisionen hittades inte');
         const share=await services!.publicShares.owned(session.ownerKey,projectId,Number(revision));
         const status=share&&!share.revoked_at&&
           (!share.expires_at||new Date(share.expires_at)>new Date())?'active':
           share?'revoked':'none';
         const completed=services!.renderJobs&&status==='active'
           ?(await services!.renderJobs.list(session.ownerKey,projectId,Number(revision)))
             .filter(j=>j.status==='completed'&&j.sha256&&j.size_bytes)
           :[];
         const candidates=[];
         for(const image of completed){
           try{
             await services!.renderedImages!.verifiedPath(
               projectId,image.id,image.sha256!,image.size_bytes!);
             candidates.push(image);
           }catch{/* Exclude missing or corrupted rendering. */}
         }
         return ownerSharePage(projectId,Number(revision),session.csrf,status,
           undefined,candidates,share?.selected_render_ids??[],
           (request.query as {message?:string}).message);
       }catch{return reply.code(404).send('Revisionen hittades inte');}
     });
     app.post('/projects/:projectId/revisions/:revision/share',{bodyLimit:4096},
       async(request,reply)=>{
       const session=google.settingsSession(request.headers.cookie);
       secure(reply).header('vary','Cookie').header('cache-control','private, no-store')
         .header('referrer-policy','no-referrer').type('text/html; charset=utf-8');
       if(!session)return reply.code(401).send('Unauthorized');
       const origin=request.headers.origin;
       const safari=origin==='null'&&request.headers['sec-fetch-site']==='same-origin';
       if(origin!==config.publicOrigin&&!safari)return reply.code(403).send('Forbidden');
       if(!(request.headers['content-type']??'').startsWith('application/x-www-form-urlencoded'))
         return reply.code(415).send('Unsupported Media Type');
       const form=new URLSearchParams(typeof request.body==='string'?request.body:'');
       if(form.get('csrf')!==session.csrf)return reply.code(403).send('Forbidden');
       const action=form.get('action');
       if(!['publish','revoke','images'].includes(action??''))return reply.code(400).send('Invalid action');
       const {projectId,revision}=request.params as {projectId:string;revision:string};
       const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
       if(!uuid.test(projectId)||!/^[1-9][0-9]{0,7}$/.test(revision)||
          !services!.publicShares)return reply.code(404).send('Revisionen hittades inte');
       try{
         const project=await services!.projects.get(session.ownerKey,projectId);
         const revisions=await services!.projects.revisions(session.ownerKey,projectId);
         if(!project||!revisions.some(r=>r.revision===Number(revision)&&r.artifact_prefix))
           return reply.code(404).send('Revisionen hittades inte');
         if(action==='revoke'){
           await services!.publicShares.revoke(session.ownerKey,projectId,Number(revision));
           return ownerSharePage(projectId,Number(revision),session.csrf,'revoked');
         }
         if(action==='images'){
           // Images are an explicit whitelist snapshot for this exact revision.
           // A render job cannot be shared until it has completed and its PNG
           // is present with the expected SHA-256 checksum.
           const ids=form.getAll('imageId');
           const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
           if(ids.length>12||ids.some(id=>!uuid.test(id))||
              new Set(ids.map(id=>id.toLowerCase())).size!==ids.length)
             return reply.code(422).send('Ogiltigt bildurval');
           if(!services!.renderJobs||!services!.renderedImages)
             return reply.code(503).send('Bildtjänsten saknas');
           for(const id of ids){
             const image=await services!.renderJobs.get(session.ownerKey,id);
             if(!image||image.project_id!==projectId||
                image.source_revision!==Number(revision)||
                image.status!=='completed'||!image.sha256||!image.size_bytes)
               return reply.code(422).send('Bilden är inte tillgänglig');
             try{
               await services!.renderedImages.verifiedPath(
                 projectId,id,image.sha256,image.size_bytes);
             }catch{return reply.code(422).send('Bilden är inte tillgänglig');}
           }
           const updated=await services!.publicShares.setSelectedRenders(
             session.ownerKey,projectId,Number(revision),ids);
           if(!updated)return reply.code(404).send('Delningen är inte aktiv');
           return reply.code(303).header('location',
             '/projects/'+projectId+'/revisions/'+revision+'/share?message=images_saved').send();
         }
         // Publication is impossible unless real, checksum-verified GLB exists.
         await services!.artifacts!.verifiedArtifactPath(projectId,Number(revision),'scene.glb');
         const created=await services!.publicShares.create(session.ownerKey,projectId,Number(revision));
         const publicUrl=config.publicOrigin+'/share/'+created.token;
         return ownerSharePage(projectId,Number(revision),session.csrf,'active',publicUrl);
       }catch{return reply.code(404).send('Revisionen hittades inte eller GLB saknas');}
     });

     // Native Blender file download is read-only, owner scoped and SHA-256
     // verified. No Blender or Modal job is started and project data is not
     // modified. Do not return an artifact from an uncommitted revision.
     app.get('/projects/:projectId/revisions/:revision/download',async(request,reply)=>{
       const session=google.settingsSession(request.headers.cookie);
       secure(reply).header('vary','Cookie').header('cache-control','private, no-store')
         .header('content-security-policy',"default-src 'none'")
         .header('x-frame-options','DENY')
         .header('cross-origin-resource-policy','same-origin');
       if(!session)return reply.redirect('/settings/login');
       const {projectId,revision}=request.params as {projectId:string;revision:string};
       const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
       if(!idPattern.test(projectId)||!/^[1-9][0-9]{0,7}$/.test(revision))
         return reply.code(404).send('Revisionen hittades inte');
       if(!services!.artifacts)return reply.code(404).send('Revisionen hittades inte');
       try{
         const project=await services!.projects.get(session.ownerKey,projectId);
         if(!project)return reply.code(404).send('Revisionen hittades inte');
         const revisions=await services!.projects.revisions(session.ownerKey,projectId);
         if(!revisions.some(r=>r.revision===Number(revision)&&r.artifact_prefix))
           return reply.code(404).send('Revisionen hittades inte');
         const native=await services!.artifacts.verifiedArtifactPath(
           projectId,Number(revision),'scene.blend');
         const filename=blendDownloadFilename(project.name,Number(revision));
         return reply.header('content-disposition','attachment; filename="'+filename+'"')
           .type('application/octet-stream').send(createReadStream(native));
       }catch{return reply.code(404).send('Revisionen hittades inte');}
     });
     app.get('/projects/:projectId',async(request,reply)=>{
       const session=google.settingsSession(request.headers.cookie);
       secure(reply).header('vary','Cookie').type('text/html; charset=utf-8');
       if(!session)return reply.redirect('/settings/login');
       const {projectId}=request.params as {projectId:string};
       if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId))
         return reply.code(404).send('Projektet hittades inte');
       try{
         const project=await services!.projects.get(session.ownerKey,projectId);
         if(!project)return reply.code(404).send('Projektet hittades inte');
         const revisions=await services!.projects.revisions(session.ownerKey,projectId);
         const previews=await Promise.all(revisions.map(async revision=>{
           if(!revision.artifact_prefix||!services!.artifacts)return {...revision,glbAvailable:false,pngAvailable:false};
           try{
             const manifest=await services!.artifacts.inspect(projectId,revision.revision,false);
             let portableStatus:'complete'|'external'|'unknown'='unknown';
             let externalCount=0;
             if(manifest.artifacts.some(a=>a.name==='scene.json')&&
                services!.artifacts.readVerifiedSmallArtifact){
               try{
                 const report=await services!.artifacts.readVerifiedSmallArtifact(
                   projectId,revision.revision,'scene.json');
                 const summary=report?portableResourceInfo(JSON.parse(report)):undefined;
                 if(summary){
                   portableStatus=summary.status;
                   externalCount=summary.externalCount;
                 }
               }catch{/* Older, oversized or tampered reports remain unknown. */}
             }
             return {...revision,portableStatus,externalCount,
               glbAvailable:manifest.artifacts.some(a=>a.name==='scene.glb'),
               pngAvailable:manifest.artifacts.some(a=>a.name==='scene.png')};
           }catch{return {...revision,portableStatus:'unknown' as const,
                glbAvailable:false,pngAvailable:false};}
         }));
         const message=(request.query as {message?:string}).message;
         const renderJobs=services!.renderJobs
           ?await services!.renderJobs.list(session.ownerKey,projectId):[];
         const modelJobsRaw=await services!.jobs.list?.(session.ownerKey,projectId,50)??[];
          const modelJobs=modelJobsRaw.map(j=>({...j,
            error_message:describeJobFailure(safeOwnerJobError(j.error_message))}));
         reply.header('content-security-policy',"default-src 'none'; img-src 'self'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
         const requestedView=(request.query as {view?:string}).view;
         const view=requestedView==='images'||requestedView==='history'||requestedView==='settings'
           ?requestedView:'overview';
         return projectDetailPage(project,previews,session.csrf,message,renderJobs,modelJobs,view);
       }catch{return reply.code(503).send('Projektet kunde inte hämtas. Försök igen senare.');}
     });
     // Render requests are explicitly billed. Never launch Modal in an HTTP request.
     app.post('/projects/:projectId/renders',{bodyLimit:4096},async(request,reply)=>{
       const session=google.settingsSession(request.headers.cookie);
       secure(reply).header('vary','Cookie');
       if(!session)return reply.code(401).send('Unauthorized');
       const origin=request.headers.origin;
       const safari=origin==='null'&&request.headers['sec-fetch-site']==='same-origin';
       if(origin!==config.publicOrigin&&!safari)return reply.code(403).send('Forbidden');
       if(!(request.headers['content-type']??'').startsWith('application/x-www-form-urlencoded'))
         return reply.code(415).send('Unsupported Media Type');
       const params=new URLSearchParams(typeof request.body==='string'?request.body:'');
       if(params.get('csrf')!==session.csrf)return reply.code(403).send('Forbidden');
       const id=(request.params as {projectId:string}).projectId;
       if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
         return reply.code(404).send('Not found');
       if(!services!.renderJobs)return reply.code(503).send('Render service unavailable');
       const project=await services!.projects.get(session.ownerKey,id);
       if(!project)return reply.code(404).send('Not found');
       try{
         const connected=await services!.modalAccounts?.status(session.ownerKey);
         if(!connected?.connected)return reply.code(409).send('Anslut Modal i Inställningar');
         const revision=Number(params.get('revision'));
         const options=validateRenderOptions({
           engine:params.get('engine') as RenderEngine,
           width:Number(params.get('size')),height:Number(params.get('size')),
           samples:Number(params.get('samples'))});
         const queued=await services!.renderJobs.reserve(session.ownerKey,id,revision,options);
         return reply.code(303).header('location','/projects/'+id+'?view=images&message=render_queued').send();
       }catch{return reply.code(303).header('location','/projects/'+id+'?view=images&message=render_error').send();}
     });
     // Signed-cookie owner-only PNG retrieval; file bytes never contain an access token.
     app.get('/renders/:projectId/:jobId.png',async(request,reply)=>{
       const session=google.settingsSession(request.headers.cookie);
       secure(reply).header('vary','Cookie').header('content-security-policy',"default-src 'none'")
         .header('cross-origin-resource-policy','same-origin');
       const {projectId,jobId}=request.params as {projectId:string;jobId:string};
       if(!session){
         // Directly opened image URLs are navigations. Embedded images and
         // fetch/API requests must not unexpectedly receive a login HTML page.
         const destination=request.headers['sec-fetch-dest'];
         if(request.method==='GET'&&destination==='document'){
           const returnTo='/renders/'+encodeURIComponent(projectId)+'/'+
             encodeURIComponent(jobId)+'.png';
           return reply.code(302).header('location',
             '/settings/login?next='+encodeURIComponent(returnTo)).send();
         }
         return reply.code(401).send('Unauthorized');
       }
       if(!/^[0-9a-f-]{36}$/i.test(projectId)||!/^[0-9a-f-]{36}$/i.test(jobId))
         return reply.code(404).send('Not found');
       if(!services!.renderJobs||!services!.renderedImages)return reply.code(404).send('Not found');
       try{
         const job=await services!.renderJobs.get(session.ownerKey,jobId);
         if(!job||job.project_id!==projectId||job.status!=='completed'||!job.sha256||!job.size_bytes)
           return reply.code(404).send('Not found');
         const file=await services!.renderedImages.verifiedPath(projectId,jobId,job.sha256,job.size_bytes);
         return reply.type('image/png').send(createReadStream(file));
       }catch{return reply.code(404).send('Not found');}
     });
     // Live status JS has no secrets, session values or write capabilities.
     app.get('/portal/assets/live-status.js',async(_request,reply)=>{
       return secure(reply).header('content-security-policy',"default-src 'none'")
         .type('application/javascript; charset=utf-8').send(liveStatusScript);
     });
     // Archive JS is static and contains no session state or credentials.
     app.get('/archive/assets/import.js',async(_request,reply)=>{
       return secure(reply).header('content-security-policy',"default-src 'none'")
         .type('application/javascript; charset=utf-8').send(importClientScript);
     });
     // Download requires the same signed Google session and owner scope as viewer.
     app.get('/projects/:projectId/export',async(request,reply)=>{
       const session=google.settingsSession(request.headers.cookie);
       secure(reply).header('vary','Cookie')
         .header('content-security-policy',"default-src 'none'")
         .header('x-frame-options','DENY');
       if(!session)return reply.redirect('/settings/login');
       const id=(request.params as {projectId:string}).projectId;
       if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
         return reply.code(404).send('Projektet hittades inte');
       if(!services!.projectArchive)return reply.code(503).send('Export är inte konfigurerad');
       try{
         const {archive,directory}=await services!.projectArchive.export(session.ownerKey,id);
         const stream=createReadStream(archive);
         // Clean up even if the browser cancels the download.
         reply.raw.once('close',()=>{void rm(directory,{recursive:true,force:true});});
         return reply.header('content-disposition','attachment; filename="blender-project.bwproject.zip"')
           .type('application/zip').send(stream);
       }catch{
         return reply.code(422).send('Projektet kunde inte exporteras. Kontrollera att revisionerna är kompletta.');
       }
     });
     app.post('/projects/import',{bodyLimit:256*1024*1024},async(request,reply)=>{
       const session=google.settingsSession(request.headers.cookie);
       secure(reply).header('vary','Cookie')
         .header('content-security-policy',"default-src 'none'");
       if(!session)return reply.code(401).send({error:'unauthorized'});
       const origin=request.headers.origin;
       const sameOriginSafari=origin==='null'&&request.headers['sec-fetch-site']==='same-origin';
       if(origin!==config.publicOrigin&&!sameOriginSafari)
         return reply.code(403).send({error:'origin_not_allowed'});
       if(!(request.headers['content-type']??'').startsWith('application/vnd.blender-workspace.project+zip'))
         return reply.code(415).send({error:'unsupported_media_type'});
       if(request.headers['x-csrf-token']!==session.csrf)
         return reply.code(403).send({error:'csrf'});
       if(!services!.projectArchive)return reply.code(503).send({error:'not_configured'});
       try{
         const id=await services!.projectArchive.import(session.ownerKey,request.body as Buffer);
         return reply.code(201).send({projectId:id});
       }catch{
         return reply.code(422).send({error:'invalid_archive'});
       }
     });
     const validProjectId=(id:string)=>
       /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
     // The confirmation page is read-only, including on Safari.
     app.get('/projects/:projectId/delete',async(request,reply)=>{
       const session=google.settingsSession(request.headers.cookie);
       secure(reply).header('vary','Cookie').type('text/html; charset=utf-8');
       if(!session)return reply.redirect('/settings/login');
       const {projectId}=request.params as {projectId:string};
       if(!validProjectId(projectId))return reply.code(404).send('Projektet hittades inte');
       try{
         const project=await services!.projects.get(session.ownerKey,projectId);
         if(!project)return reply.code(404).send('Projektet hittades inte');
         const message=(request.query as {message?:string}).message;
         return projectDeletePage(project,session.csrf,message);
       }catch{return reply.code(503).send('Projektet kunde inte hämtas.');}
     });
     // Reuse settings' exact-origin + Safari null-origin exception, signed
     // Google session and per-session CSRF token. No MCP bearer in forms.
     for(const action of ['rename','description','delete'] as const){
       app.post('/projects/:projectId/'+action,{bodyLimit:action==='description'?65536:4096},async(request,reply)=>{
         const session=google.settingsSession(request.headers.cookie);
         secure(reply).header('vary','Cookie');
         if(!session)return reply.code(401).send('Unauthorized');
         const origin=request.headers.origin;
         const sameOriginSafari=origin==='null'&&
           request.headers['sec-fetch-site']==='same-origin';
         if(origin!==config.publicOrigin&&!sameOriginSafari)
           return reply.code(403).send('Forbidden');
         if(!(request.headers['content-type']??'').startsWith('application/x-www-form-urlencoded'))
           return reply.code(415).send('Unsupported Media Type');
         const form=new URLSearchParams(typeof request.body==='string'?request.body:'');
         if(form.get('csrf')!==session.csrf)return reply.code(403).send('Forbidden');
         const {projectId}=request.params as {projectId:string};
         if(!validProjectId(projectId))return reply.code(404).send('Projektet hittades inte');
         try{
           const project=await services!.projects.get(session.ownerKey,projectId);
           if(!project)return reply.code(404).send('Projektet hittades inte');
           if(action==='rename'){
             const name=form.get('name')??'';
             if(!name.trim()||name.length>200)
               return reply.code(303).header('location','/projects/'+projectId+'?view=settings&message=invalid').send();
             const renamed=await services!.projects.rename(session.ownerKey,projectId,name);
             if(!renamed)return reply.code(404).send('Projektet hittades inte');
             return reply.code(303).header('location','/projects/'+projectId+'?view=settings&message=renamed').send();
           }
           if(action==='description'){
             const description=form.get('description')??'';
             if(description.length>5000)
               return reply.code(303).header('location','/projects/'+projectId+'?view=settings&message=description_invalid').send();
             const updated=await services!.projects.updateDescription(session.ownerKey,projectId,description);
             if(!updated)return reply.code(404).send('Projektet hittades inte');
             return reply.code(303).header('location','/projects/'+projectId+'?view=settings&message=description_updated').send();
           }
           // The separate confirmation form requires a checked confirmation.
           if(form.get('confirm')!=='yes')return reply.code(400).send('Bekräftelse saknas');
           if(!services!.projectDeletion)
             return reply.code(503).send('Projektborttagning är inte konfigurerad');
           const outcome=await services!.projectDeletion.delete(session.ownerKey,projectId);
           if(outcome==='missing')return reply.code(404).send('Projektet hittades inte');
           if(outcome==='busy')
             return reply.code(303).header('location','/projects/'+projectId+'/delete?message=busy').send();
           return reply.code(303).header('location','/').send();
         }catch{
           // A permanent deletion may have committed its tombstone but failed
           // file cleanup. The project detail is then intentionally hidden.
           if(action==='delete')
             return reply.code(303).header('location','/?message=cleanup').send();
           return reply.code(303).header('location','/projects/'+projectId+'?view=settings&message=error').send();
         }
       });
     }
     app.get('/settings/login',async(request,reply)=>{
       const query=request.query as {next?:unknown};
       const next=typeof query.next==='string'?query.next:undefined;
       let response;
       try{response=await google.beginSettingsLogin(next);}
       catch{return reply.code(400).send('Invalid return path');}
       for(const [key,value] of Object.entries(response.headers))reply.header(key,value);
       reply.code(response.status);return response.body;
     });
     app.get('/settings',async(request,reply)=>{
       const session=google.settingsSession(request.headers.cookie);
       if(!session)return secure(reply).redirect('/settings/login');
       const status=await accounts.status(session.ownerKey);
       const memoryMiB=await accounts.memoryMiB(session.ownerKey);
       const msg=(request.query as {message?:string}).message;
       const safeMessage=msg==='connected'?'Modal-kontot är anslutet.':
         msg==='verified'?'Modal-anslutningen fungerar.':
         msg==='disconnected'?'Modal-kontot har kopplats bort.':
         msg==='memory_saved'?'Minnesreservationen har sparats.':
         msg==='memory_invalid'?'Välj ett giltigt minnesvärde.':
         msg==='error'?'Åtgärden kunde inte genomföras.':'';
       secure(reply).type('text/html; charset=utf-8');
       return page(session.csrf,status.connected?'Ansluten':status.needsRenewal?'Behöver förnyas':'Ej ansluten',safeMessage,memoryMiB);
     });
     for(const action of ['save','test','disconnect','logout','memory'] as const){
       app.post('/settings/'+(action==='logout'?'logout':'modal/'+action),
         {bodyLimit:4096},async(request,reply)=>{
         const session=google.settingsSession(request.headers.cookie);
         if(!session)return secure(reply).code(401).send('Unauthorized');
         // Safari can send Origin: null for a same-origin HTML form navigation.
         // Accept it only with explicit browser Fetch Metadata; the signed
         // settings session and the per-session CSRF field are required below.
         // Missing Origin or cross-site/none Fetch Metadata never bypasses this.
         const origin=request.headers.origin;
         const sameOriginSafari=origin==='null'&&
           request.headers['sec-fetch-site']==='same-origin';
         if(origin!==config.publicOrigin&&!sameOriginSafari)
           return secure(reply).code(403).send('Forbidden');
         if(!(request.headers['content-type']??'').startsWith('application/x-www-form-urlencoded'))
           return secure(reply).code(415).send('Unsupported Media Type');
         const form=new URLSearchParams(typeof request.body==='string'?request.body:'');
         if(form.get('csrf')!==session.csrf)return secure(reply).code(403).send('Forbidden');
         if(action==='logout'){
           const response=google.logoutSettings();
           for(const [key,value] of Object.entries(response.headers))reply.header(key,value);
           reply.code(response.status);return response.body;
         }
         let message='error';
         try{
           if(action==='memory'){
             const raw=form.get('memoryMiB')??'';
             if(!['2048','4096','8192','16384'].includes(raw)){
               message='memory_invalid';
             }else{
               await accounts.setMemoryMiB(session.ownerKey,Number(raw));
               message='memory_saved';
             }
           }else if(action==='save'){
             await accounts.saveAndTest(session.ownerKey,form.get('tokenId')??'',form.get('tokenSecret')??'');
             message='connected';
           }else if(action==='test'){
             await accounts.test(session.ownerKey);
             message='verified';
           }else if(action==='disconnect'){
             await accounts.disconnect(session.ownerKey);
             message='disconnected';
           }
         }catch{
           // Never expose credential text, Modal errors or stack traces in HTML.
         }
         return secure(reply).code(303).header('location','/settings?message='+message).send();
       });
     }
   }
   app.get('/.well-known/oauth-authorization-server',async()=>google.metadata());
   app.get('/jwks',async(_request,reply)=>{
     reply.header('cache-control','public, max-age=300');return google.jwks;
   });
   app.post('/register',{bodyLimit:16*1024},async(request,reply)=>{
     const answer=await google.register(request.body);
     for(const [key,value] of Object.entries(answer.headers))reply.header(key,value);
     reply.code(answer.status);return answer.body;
   });
   app.get('/authorize',async(request,reply)=>{
     const answer=await google.authorize(request.query as Record<string,unknown>);
     for(const [key,value] of Object.entries(answer.headers))reply.header(key,value);
     reply.code(answer.status);return answer.body;
   });
   app.get('/auth/google/callback',async(request,reply)=>{
     const answer=await google.callbackLogin(request.query as Record<string,unknown>,request.headers.cookie);
     for(const [key,value] of Object.entries(answer.headers))reply.header(key,value);
     reply.code(answer.status);return answer.body;
   });
   app.post('/token',{bodyLimit:8*1024},async(request,reply)=>{
     if(!(request.headers['content-type']??'').startsWith('application/x-www-form-urlencoded'))
       return reply.code(415).send({error:'invalid_request'});
     const form=new URLSearchParams(typeof request.body==='string'?request.body:'');
     const answer=await google.token(Object.fromEntries(form));
     for(const [key,value] of Object.entries(answer.headers))reply.header(key,value);
     reply.code(answer.status);return answer.body;
   });
 }

 // The browser uses only the existing signed, HttpOnly Google settings session.
 // Never expose MCP access tokens to the page or put credentials in the URL.
 if(options?.google&&services?.artifacts){
   const google=options.google;
   const viewerHeaders=(reply:any)=>reply.header('cache-control','private, no-store')
     .header('x-content-type-options','nosniff')
     .header('referrer-policy','no-referrer')
     .header('x-frame-options','DENY')
     .header('cross-origin-resource-policy','same-origin')
     .header('vary','Cookie');
   const validViewerParams=(projectId:string,rev:string)=>
     /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)&&
     /^[1-9][0-9]{0,7}$/.test(rev);
   async function ownedRevision(owner:string,projectId:string,revision:number){
     const project=await services!.projects.get(owner,projectId);
     if(!project)return false;
     return (await services!.projects.revisions(owner,projectId))
       .some(v=>v.revision===revision&&v.artifact_prefix);
   }
   // A separate read-only public viewer never reuses the private viewer's
   // authenticated APIs. Every asset request validates the revocable token.
   const publicHeaders=(reply:any)=>reply.header('cache-control','no-store')
     .header('referrer-policy','no-referrer')
     .header('x-content-type-options','nosniff')
     .header('x-robots-tag','noindex, nofollow, noarchive')
     .header('x-frame-options','DENY')
     .header('cross-origin-resource-policy','same-origin');
   app.get('/share/assets/public-viewer.js',async(_request,reply)=>{
     return publicHeaders(reply).header('content-security-policy',"default-src 'none'")
       .type('application/javascript; charset=utf-8')
       .send(createReadStream(fileURLToPath(new URL('./public-viewer.js',import.meta.url))));
   });
   app.get('/share/:token',async(request,reply)=>{
     publicHeaders(reply).header('content-security-policy',
       "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
     const {token}=request.params as {token:string};
     if(!validShareToken(token)||!services!.publicShares)
       return reply.code(404).send('Delningen hittades inte');
     try{
       const share=await services!.publicShares.resolve(token);
       if(!share)return reply.code(404).send('Delningen hittades inte');
       await services!.artifacts!.verifiedArtifactPath(share.project_id,share.revision,'scene.glb');
       const publicImages=[];
       if(share.allow_renders&&services!.renderJobs&&services!.renderedImages){
         for(const id of share.selected_render_ids.slice(0,12)){
           const image=await services!.renderJobs.get(share.owner_key,id);
           if(!image||image.project_id!==share.project_id||
              image.source_revision!==share.revision||
              image.status!=='completed'||!image.sha256||!image.size_bytes)continue;
           try{
             await services!.renderedImages.verifiedPath(
               share.project_id,id,image.sha256,image.size_bytes);
             publicImages.push(image);
           }catch{/* Broken images are not offered in the gallery. */}
         }
       }
       return reply.type('text/html; charset=utf-8')
         .send(publicSharePage(token,share.project_name,share.revision,publicImages));
     }catch{return reply.code(404).send('Delningen hittades inte');}
   });
   // Public PNG is always checked against the current active share's
   // explicit whitelist, revision, owner, completed job and file checksum.
   // No private render path is exposed to the anonymous viewer.
   app.get('/share/:token/renders/:imageId.png',async(request,reply)=>{
     publicHeaders(reply).header('content-security-policy',"default-src 'none'");
     const {token,imageId}=request.params as {token:string;imageId:string};
     const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
     if(!validShareToken(token)||!uuid.test(imageId)||!services!.publicShares||
        !services!.renderJobs||!services!.renderedImages)
       return reply.code(404).send({error:'not_found'});
     try{
       const share=await services!.publicShares.resolve(token);
       if(!share||!share.allow_renders||
          !share.selected_render_ids.some(id=>id.toLowerCase()===imageId.toLowerCase()))
         return reply.code(404).send({error:'not_found'});
       const image=await services!.renderJobs.get(share.owner_key,imageId);
       if(!image||image.project_id!==share.project_id||
          image.source_revision!==share.revision||
          image.status!=='completed'||!image.sha256||!image.size_bytes)
         return reply.code(404).send({error:'not_found'});
       const file=await services!.renderedImages.verifiedPath(
         share.project_id,imageId,image.sha256,image.size_bytes);
       return reply.type('image/png').send(createReadStream(file));
     }catch{return reply.code(404).send({error:'not_found'});}
   });
   app.get('/share/:token/scene.glb',async(request,reply)=>{
     publicHeaders(reply).header('content-security-policy',"default-src 'none'");
     const {token}=request.params as {token:string};
     if(!validShareToken(token)||!services!.publicShares)
       return reply.code(404).send({error:'not_found'});
     try{
       const share=await services!.publicShares.resolve(token);
       if(!share)return reply.code(404).send({error:'not_found'});
       const file=await services!.artifacts!.verifiedArtifactPath(share.project_id,share.revision,'scene.glb');
       return reply.type('model/gltf-binary').send(createReadStream(file));
     }catch{return reply.code(404).send({error:'not_found'});}
   });
   app.get('/viewer/assets/viewer.js',async(_request,reply)=>{
     viewerHeaders(reply).header('content-security-policy',"default-src 'none'");
     return reply.type('application/javascript; charset=utf-8')
       .send(createReadStream(fileURLToPath(new URL('./viewer.js',import.meta.url))));
   });
   app.get('/viewer/:projectId/revisions/:revision',async(request,reply)=>{
     viewerHeaders(reply).header('content-security-policy',
       "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; img-src 'self' blob: data:; base-uri 'none'; frame-ancestors 'none'");
     const session=google.settingsSession(request.headers.cookie);
     if(!session)return reply.redirect('/settings/login');
     const {projectId,revision}=request.params as {projectId:string;revision:string};
     if(!validViewerParams(projectId,revision))return reply.code(404).send('Not found');
     try{
       if(!await ownedRevision(session.ownerKey,projectId,Number(revision)))
         return reply.code(404).send('Not found');
       // Credentials never appear in HTML, nor in the bundled JavaScript.
       return reply.type('text/html; charset=utf-8').send(viewerPage(projectId,Number(revision)));
     }catch{return reply.code(404).send('Not found');}
   });
   // Returns only revisions belonging to the signed-in user and containing
   // a verified GLB. No file paths, private metadata, or tokens are exposed.
   app.get('/viewer/api/projects/:projectId/revisions',async(request,reply)=>{
     viewerHeaders(reply).header('content-security-policy',"default-src 'none'");
     const session=google.settingsSession(request.headers.cookie);
     if(!session)return reply.code(401).send({error:'unauthorized'});
     const {projectId}=request.params as {projectId:string};
     if(!validViewerParams(projectId,'1'))
       return reply.code(404).send({error:'not_found'});
     if(request.headers.origin&&request.headers.origin!==config.publicOrigin)
       return reply.code(403).send({error:'origin_not_allowed'});
     try{
       const project=await services.projects.get(session.ownerKey,projectId);
       if(!project)return reply.code(404).send({error:'not_found'});
       const revisions=await services.projects.revisions(session.ownerKey,projectId);
       const available:number[]=[];
       // Limit manifest and checksum reads on a single interactive request.
       for(const r of revisions.filter(r=>r.artifact_prefix).slice(-100)){
         try{
           await services.artifacts!.verifiedArtifactPath(projectId,r.revision,'scene.glb');
           available.push(r.revision);
         }catch{/* Unavailable/corrupt revisions must not be advertised. */}
       }
       return reply.type('application/json').send({projectId,revisions:available});
     }catch{return reply.code(404).send({error:'not_found'});}
   });
   // Signed, owner-scoped render history for the selected model revision.
   app.get('/viewer/api/projects/:projectId/revisions/:revision/renders',async(request,reply)=>{
     viewerHeaders(reply).header('content-security-policy',"default-src 'none'");
     const session=google.settingsSession(request.headers.cookie);
     if(!session)return reply.code(401).send({error:'unauthorized'});
     const {projectId,revision}=request.params as {projectId:string;revision:string};
     if(!validViewerParams(projectId,revision))return reply.code(404).send({error:'not_found'});
     if(request.headers.origin&&request.headers.origin!==config.publicOrigin)
       return reply.code(403).send({error:'origin_not_allowed'});
     if(!services!.renderJobs)return reply.code(503).send({error:'unavailable'});
     try{
       if(!await ownedRevision(session.ownerKey,projectId,Number(revision)))
         return reply.code(404).send({error:'not_found'});
       const rows=await services!.renderJobs.list(session.ownerKey,projectId,Number(revision));
       return reply.send({csrf:session.csrf,renders:rows.map(r=>({
         id:r.id,revision:r.source_revision,status:r.status,engine:r.engine,
         width:r.width,height:r.height,samples:r.samples,
         requestedFrom:r.requested_from??'project',
         createdAt:r.created_at,error:r.error_code??null,
         imageUrl:r.status==='completed'
           ?'/renders/'+encodeURIComponent(projectId)+'/'+encodeURIComponent(r.id)+'.png':null
       }))});
     }catch{return reply.code(503).send({error:'unavailable'});}
   });
   // Explicitly charged POST, protected by owner cookie, origin and CSRF checks.
   app.post('/viewer/api/projects/:projectId/revisions/:revision/renders',
     {bodyLimit:4096},async(request,reply)=>{
     viewerHeaders(reply).header('content-security-policy',"default-src 'none'");
     const session=google.settingsSession(request.headers.cookie);
     if(!session)return reply.code(401).send({error:'unauthorized'});
     const {projectId,revision}=request.params as {projectId:string;revision:string};
     if(!validViewerParams(projectId,revision))return reply.code(404).send({error:'not_found'});
     const origin=request.headers.origin;
     const safari=origin==='null'&&request.headers['sec-fetch-site']==='same-origin';
     if(origin!==config.publicOrigin&&!safari)return reply.code(403).send({error:'origin_not_allowed'});
     if(!(request.headers['content-type']??'').startsWith('application/json'))
       return reply.code(415).send({error:'unsupported_media_type'});
     if(request.headers['x-csrf-token']!==session.csrf)
       return reply.code(403).send({error:'csrf'});
     if(!services!.renderJobs||!services!.modalAccounts)
       return reply.code(503).send({error:'unavailable'});
     try{
       if(!await ownedRevision(session.ownerKey,projectId,Number(revision)))
         return reply.code(404).send({error:'not_found'});
       const connected=await services!.modalAccounts.status(session.ownerKey);
       if(!connected?.connected)return reply.code(409).send({error:'modal_not_connected'});
       const payload=request.body as {camera?:unknown;viewportWidth?:number;viewportHeight?:number};
       const camera=validateViewerCamera(payload?.camera);
       const size=viewerDimensions(payload.viewportWidth!,payload.viewportHeight!);
       const options=validateRenderOptions({
         engine:'CYCLES',samples:16,width:size.width,height:size.height,
         requestedFrom:'viewer',camera
       });
       const job=await services!.renderJobs.reserve(session.ownerKey,projectId,Number(revision),options);
       return reply.code(202).send({jobId:job.id,status:'pending'});
     }catch(error){
       if(error instanceof RangeError)return reply.code(422).send({error:'invalid_or_busy'});
       return reply.code(503).send({error:'unavailable'});
     }
   });
   app.get('/viewer/api/projects/:projectId/revisions/:revision/scene.glb',async(request,reply)=>{
     viewerHeaders(reply).header('content-security-policy',"default-src 'none'");
     const session=google.settingsSession(request.headers.cookie);
     if(!session)return reply.code(401).send({error:'unauthorized'});
     const {projectId,revision}=request.params as {projectId:string;revision:string};
     if(!validViewerParams(projectId,revision))return reply.code(404).send({error:'not_found'});
     if(request.headers.origin&&request.headers.origin!==config.publicOrigin)
       return reply.code(403).send({error:'origin_not_allowed'});
     try{
       if(!await ownedRevision(session.ownerKey,projectId,Number(revision)))
         return reply.code(404).send({error:'not_found'});
       const file=await activeGlb(session.ownerKey,projectId,Number(revision));
       return reply.type('model/gltf-binary').send(createReadStream(file));
     }catch{return reply.code(404).send({error:'not_found'});}
   });
 }

 app.get('/health/live',async()=>({status:'alive',service:'blender-workspace'}));
 app.get('/health/ready',async()=>({status:'ready',service:'blender-workspace',
   integrations:services?'project_metadata':'not_configured'}));

 app.addHook('onRequest',async(request,reply)=>{
   const path=request.url.split('?')[0];
   // GLB downloads have the same bearer auth and owner context as MCP calls.
   if(path!=='/mcp'&&!path.startsWith('/api/projects/'))return;
   if(request.headers.origin&&request.headers.origin!==config.publicOrigin) {
     reply.code(403).send({error:'origin_not_allowed'});return;
   }
   if(config.oauth) {
     const token=request.headers.authorization?.startsWith('Bearer ')
       ?request.headers.authorization.slice(7):'';
     try {
       if(!token)throw new Error('Missing token');
       principals.set(request,await verifyOAuthAccessToken(token,config.oauth,keys!));
     }catch {
       reply.header('WWW-Authenticate',bearerChallenge(config.oauth))
         .code(401).send({error:'unauthorized'});return;
     }
   }else {
     if(!authorized(request.headers.authorization,config.accessToken)){
       reply.header('WWW-Authenticate','Bearer realm="blender-workspace"')
         .code(401).send({error:'unauthorized'});return;
     }
     if(config.ownerKey)principals.set(request,{ownerKey:config.ownerKey,
       scopes:new Set([READ_SCOPE,WRITE_SCOPE])});
   }
 });

 // DEV-018: deliberately no token-bearing URL or public download link.
 // Each request is authenticated independently and checked against project ownership.
 app.get('/api/projects/:projectId/revisions/:revision/scene.glb',async(request,reply)=>{
   const principal=principals.get(request);
   reply.header('cache-control','private, no-store')
     .header('x-content-type-options','nosniff')
     .header('cross-origin-resource-policy','same-origin')
     .header('content-security-policy',"default-src 'none'")
     .header('vary','Authorization');
   if(!principal)return reply.code(401).send({error:'unauthorized'});
   if(!principal.scopes.has(READ_SCOPE))
     return reply.code(403).send({error:'insufficient_scope'});
   if(!services?.artifacts)return reply.code(404).send({error:'not_found'});
   const {projectId,revision}=request.params as {projectId:string;revision:string};
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)||
       !/^[1-9][0-9]{0,7}$/.test(revision))
     return reply.code(404).send({error:'not_found'});
   const revisionNo=Number(revision);
   try{
     const project=await services.projects.get(principal.ownerKey,projectId);
     if(!project)return reply.code(404).send({error:'not_found'});
     const revisions=await services.projects.revisions(principal.ownerKey,projectId);
     if(!revisions.some(v=>v.revision===revisionNo&&v.artifact_prefix))
       return reply.code(404).send({error:'not_found'});
     // This checks the manifest and actual file SHA-256 before streaming.
     const file=await activeGlb(principal.ownerKey,projectId,revisionNo);
     return reply.type('model/gltf-binary').send(createReadStream(file));
   }catch{
     // Do not disclose whether a foreign, corrupt or missing revision exists.
     return reply.code(404).send({error:'not_found'});
   }
 });

 app.post('/mcp',async(request,reply)=>{
   const server=new McpServer({name:'blender-workspace',version:'0.8.0'});
   server.registerTool('workspace_status',{
     title:'Blender Workspace status',
     description:'Read service capabilities; Modal jobs run in a separate worker.',
     inputSchema:{},
     ...(config.oauth?{_meta:{securitySchemes:[{type:'oauth2' as const,scopes:[READ_SCOPE]}]}}:{})
   },async()=>({content:[{type:'text' as const,text:JSON.stringify({
     service:'blender-workspace',stage:'DEV-008',
     project_tools_available:Boolean(services),
     // Indicates the queue API is configured, not that the independent worker is healthy.
     blender_jobs_available:Boolean(services?.modalAccounts&&services?.artifacts),
     blender_jobs_availability_scope:'queue_only',worker_health:'not_checked'})}]}));
   if(services){
     const principal=principals.get(request);
     if(!principal){reply.code(401).send({error:'unauthorized'});return;}
     registerProjectTools(server,{ownerKey:principal.ownerKey,
       projects:services.projects,jobs:services.jobs,
       ...(services.artifacts?{artifacts:services.artifacts}:{}),
        ...(services.projectClone?{projectClone:services.projectClone}:{}),
        ...(services.uploads?{uploads:services.uploads}:{}),
       ...(services.modalAccounts?{modalAccounts:services.modalAccounts}:{}),
       ...(services.renderJobs?{renderJobs:services.renderJobs}:{}),
       ...(services.renderedImages?{renderedImages:services.renderedImages}:{}),
       ...(services.glbPreviews?{glbPreviews:services.glbPreviews}:{}),
       ...(services.glbPreviewFiles?{glbPreviewFiles:services.glbPreviewFiles}:{}),
       ...(options?.google?{viewerOrigin:config.publicOrigin}:{})},principal.scopes,Boolean(config.oauth),config.oauth?.resource);
   }
   const transport=new NodeStreamableHTTPServerTransport({sessionIdGenerator:undefined});
   let closed=false;
   const close=()=>{if(closed)return;closed=true;void transport.close();void server.close();};
   reply.hijack();
   reply.raw.once('close',close);
   try {
     await server.connect(transport);
     await transport.handleRequest(request.raw,reply.raw,request.body);
   }catch(error){
     request.log.error({error},'MCP request failure');
     if(!reply.raw.headersSent){
       reply.raw.statusCode=500;reply.raw.setHeader('content-type','application/json');
       reply.raw.end(JSON.stringify({error:'mcp_internal_error'}));
     }else reply.raw.end();
     close();
   }
 });
 for(const method of ['GET','DELETE'] as const){
   app.route({method,url:'/mcp',handler:async(_request,reply)=>{
     reply.code(405).header('Allow','POST').send({error:'method_not_allowed'});
   }});
 }
 return app;
}
