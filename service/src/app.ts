import Fastify from 'fastify';
import {createReadStream} from 'node:fs';
import {rm} from 'node:fs/promises';
import type {ProjectArchiveService} from './jobs/project-archive.js';
import {importClientScript} from './web/import-client.js';
import {fileURLToPath} from 'node:url';
import {viewerPage} from './viewer-page.js';
import type {ProjectDeletionService} from './jobs/project-deletion.js';
import {projectIndexPage,projectDetailPage,projectDeletePage} from './web/project-pages.js';
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
  projectArchive?:Pick<ProjectArchiveService,'export'|'import'>},
 options?: {keys?:Jwks;google?:GoogleOAuthServer}) {
 if(config.authMode!=='internal'&&!services)throw new Error('OAuth requires project services');
 if(config.authMode==='internal'&&services&&(!config.ownerKey||services.ownerKey!==config.ownerKey))
   throw new Error('Internal owner identity mismatch');
 const app=Fastify({logger:{level:'info'},disableRequestLogging:true,bodyLimit:256*1024,trustProxy:false});
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
     {parseAs:'buffer',bodyLimit:128*1024*1024},(_request,body,done)=>done(null,body));
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
     const page=(csrf:string,status:string,message:string)=>`<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blender Workspace – Modal</title>
<style>body{font-family:system-ui,sans-serif;max-width:660px;margin:48px auto;padding:0 20px}
section{border:1px solid #bbb;border-radius:12px;padding:20px}
label{display:block;margin-top:12px}input{box-sizing:border-box;width:100%;padding:12px}
button{padding:10px 16px;margin:12px 8px 0 0}</style></head><body>
<section><p><a href="/">← Mina projekt</a></p><h1>Modal – Blender Workspace</h1><p>Kontostatus: ${escape(status)}</p>
<p>${escape(message)}</p><p>Dina Modal-uppgifter lagras krypterat och visas aldrig i ChatGPT.</p>
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
         const items=await Promise.all(projects.map(async project=>({
           project,revisions:await services!.projects.revisions(session.ownerKey,project.id)
         })));
         const message=(request.query as {message?:string}).message;
         reply.header('content-security-policy',"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
         return projectIndexPage(items,message,session.csrf);
       }catch{return reply.code(503).send('Projektlistan kunde inte hämtas. Försök igen senare.');}
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
         const message=(request.query as {message?:string}).message;
         return projectDetailPage(project,revisions,session.csrf,message);
       }catch{return reply.code(503).send('Projektet kunde inte hämtas. Försök igen senare.');}
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
     app.post('/projects/import',{bodyLimit:128*1024*1024},async(request,reply)=>{
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
     for(const action of ['rename','delete'] as const){
       app.post('/projects/:projectId/'+action,{bodyLimit:4096},async(request,reply)=>{
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
               return reply.code(303).header('location','/projects/'+projectId+'?message=invalid').send();
             const renamed=await services!.projects.rename(session.ownerKey,projectId,name);
             if(!renamed)return reply.code(404).send('Projektet hittades inte');
             return reply.code(303).header('location','/projects/'+projectId+'?message=renamed').send();
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
           return reply.code(303).header('location','/projects/'+projectId+'?message=error').send();
         }
       });
     }
     app.get('/settings/login',async(_request,reply)=>{
       const response=await google.beginSettingsLogin();
       for(const [key,value] of Object.entries(response.headers))reply.header(key,value);
       reply.code(response.status);return response.body;
     });
     app.get('/settings',async(request,reply)=>{
       const session=google.settingsSession(request.headers.cookie);
       if(!session)return secure(reply).redirect('/settings/login');
       const status=await accounts.status(session.ownerKey);
       const msg=(request.query as {message?:string}).message;
       const safeMessage=msg==='connected'?'Modal-kontot är anslutet.':
         msg==='verified'?'Modal-anslutningen fungerar.':
         msg==='disconnected'?'Modal-kontot har kopplats bort.':
         msg==='error'?'Åtgärden kunde inte genomföras.':'';
       secure(reply).type('text/html; charset=utf-8');
       return page(session.csrf,status.connected?'Ansluten':status.needsRenewal?'Behöver förnyas':'Ej ansluten',safeMessage);
     });
     for(const action of ['save','test','disconnect','logout'] as const){
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
           if(action==='save'){
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
       const file=await services.artifacts!.verifiedArtifactPath(projectId,Number(revision),'scene.glb');
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
     const file=await services.artifacts.verifiedArtifactPath(projectId,revisionNo,'scene.glb');
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
       ...(services.modalAccounts?{modalAccounts:services.modalAccounts}:{}),
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
