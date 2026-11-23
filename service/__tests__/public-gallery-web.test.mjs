import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../dist/app.js';

const origin='https://blender-workspace.example.test';
const projectId=randomUUID(),otherProject=randomUUID(),owner='oauth:'+'a'.repeat(64);
const csrf='gallery-csrf',revision=3,token='X'.repeat(43);
const ids=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(48)]);
const base='/projects/'+projectId+'/revisions/3/share';
function fixture(t){
 let active=true,selected=[],saved=0,broken=new Set(),attempted=0;
 const project={id:projectId,name:'Test Model',description:'Private',current_revision:4,
   created_at:new Date(),updated_at:new Date()};
 const rows=[
   {id:ids[0],project_id:projectId,source_revision:3,owner_key:owner,
     status:'completed',sha256:'a'.repeat(64),size_bytes:png.length,
     width:512,height:512,engine:'CYCLES',created_at:new Date()},
   {id:ids[1],project_id:projectId,source_revision:3,owner_key:owner,
     status:'completed',sha256:'a'.repeat(64),size_bytes:png.length,
     width:1024,height:1024,engine:'BLENDER_EEVEE_NEXT',created_at:new Date()},
   {id:ids[2],project_id:projectId,source_revision:4,owner_key:owner,
     status:'completed',sha256:'a'.repeat(64),size_bytes:png.length,
     width:512,height:512,engine:'CYCLES',created_at:new Date()},
   {id:ids[3],project_id:otherProject,source_revision:3,owner_key:owner,
     status:'completed',sha256:'a'.repeat(64),size_bytes:png.length,
     width:512,height:512,engine:'CYCLES',created_at:new Date()},
 ];
 const directory=mkdtemp(path.join(os.tmpdir(),'public-gallery-'));
 const filename=directory.then(dir=>path.join(dir,'render.png'));
 const google={settingsSession(cookie){
   return cookie==='owner-session'?{ownerKey:owner,csrf}:undefined;
 }};
 const renderJobs={
   async list(o,p,rev){assert.equal(o,owner);assert.equal(p,projectId);
     return rows.filter(r=>r.project_id===p&&r.source_revision===rev);},
   async get(o,id){assert.equal(o,owner);return rows.find(r=>r.id===id)??null;}
 };
 const renderedImages={async verifiedPath(p,id,sha,size){
   attempted++;
   if(p!==projectId||broken.has(id)||sha!=='a'.repeat(64)||
      size!==png.length)throw new Error('Checksum mismatch');
   return await filename;
 }};
 const shares={
   async owned(){return {project_id:projectId,revision:3,
     created_at:new Date(),revoked_at:active?null:new Date(),expires_at:null,
     allow_renders:selected.length>0,selected_render_ids:selected};},
   async setSelectedRenders(o,p,r,imageIds){
     assert.equal(o,owner);assert.equal(p,projectId);assert.equal(r,3);
     if(!active)return false;
     if(imageIds.some(id=>!rows.some(row=>row.id===id&&row.project_id===projectId&&
       row.source_revision===3&&row.status==='completed')))return false;
     selected=[...imageIds];saved++;return true;
   },
   async resolve(t){return active&&t===token?{
     project_id:projectId,revision:3,owner_key:owner,project_name:'Test Model',
     allow_glb:true,allow_renders:selected.length>0,allow_download:false,
     selected_render_ids:[...selected]}:null;},
   async revoke(){active=false;return true;}
 };
 const app=createApp({authMode:'google',google:{},publicOrigin:origin,
   host:'127.0.0.1',port:3000,accessToken:''},
   {projects:{
     async get(o,p){return o===owner&&p===projectId?project:null;},
     async revisions(o,p){return o===owner&&p===projectId?
       [{revision:3,artifact_prefix:'saved',note:'Saved',created_at:new Date()}]:[];}
   },jobs:{async list(){return [];}},
   modalAccounts:{async status(){return {connected:false};}},
   artifacts:{async verifiedArtifactPath(){return '/tmp/nonexistent-test.glb';}},
   renderJobs,renderedImages,publicShares:shares},{google});
 t.after(async()=>{await app.close();await rm(await directory,{recursive:true,force:true});});
 const post=(selectedIds,headers={cookie:'owner-session',origin},action='images')=>app.inject({
   method:'POST',url:base,headers:{...headers,
     'content-type':'application/x-www-form-urlencoded'},
   payload:new URLSearchParams([['csrf',csrf],['action',action],
     ...selectedIds.map(id=>['imageId',id])]).toString()
 });
 return {app,post,rows,filename,get saved(){return saved;},
   get attempted(){return attempted;},get selected(){return selected;},
   set brokenId(id){broken.add(id);},set active(v){active=v;}};
}

test('DEV-056 only explicitly approved same-revision complete PNGs appear publicly',async t=>{
 const f=fixture(t);await writeFile(await f.filename,png);
 const share='/share/'+token;
 let page=await f.app.inject({method:'GET',url:share});
 assert.equal(page.statusCode,200,page.body);
 assert.doesNotMatch(page.body,/public-gallery-grid/);
 assert.equal((await f.app.inject({method:'GET',
   url:share+'/renders/'+ids[0]+'.png'})).statusCode,404);
 const ownerPage=await f.app.inject({method:'GET',url:base,
   headers:{cookie:'owner-session'}});
 assert.equal(ownerPage.statusCode,200,ownerPage.body);
 assert.match(ownerPage.body,/Publika renderade bilder/);
 assert.match(ownerPage.body,new RegExp(ids[0]));
 assert.doesNotMatch(ownerPage.body,new RegExp(ids[2]));
 const selected=await f.post([ids[0]]);
 assert.equal(selected.statusCode,303,selected.body);
 assert.equal(f.saved,1);
 page=await f.app.inject({method:'GET',url:share});
 assert.equal(page.statusCode,200,page.body);
 assert.match(page.body,/public-gallery-grid/);
 assert.match(page.body,new RegExp(ids[0]));
 assert.doesNotMatch(page.body,new RegExp(ids[1]));
 assert.doesNotMatch(page.body,new RegExp(ids[2]));
 assert.doesNotMatch(page.body,//renders\/\w{8}-/);
 const image=await f.app.inject({method:'GET',url:share+'/renders/'+ids[0]+'.png'});
 assert.equal(image.statusCode,200,image.body);
 assert.deepEqual(image.rawPayload,png);
 assert.match(image.headers['content-type'],/image\/png/);
 assert.match(image.headers['cache-control'],/no-store/);
 assert.equal((await f.app.inject({method:'GET',
   url:share+'/renders/'+ids[1]+'.png'})).statusCode,404);
 // Gallery changes preserve the share token and immediately revoke removed images.
 assert.equal((await f.post([ids[1]])).statusCode,303);
 assert.equal((await f.app.inject({method:'GET',
   url:share+'/renders/'+ids[0]+'.png'})).statusCode,404);
 assert.equal((await f.app.inject({method:'GET',
   url:share+'/renders/'+ids[1]+'.png'})).statusCode,200);
 assert.equal((await f.post([])).statusCode,303);
 assert.equal((await f.app.inject({method:'GET',
   url:share+'/renders/'+ids[1]+'.png'})).statusCode,404);
});
test('DEV-056 CSRF, owner, revision and file integrity gates protect gallery',async t=>{
 const f=fixture(t);await writeFile(await f.filename,png);
 assert.equal((await f.post([ids[0]],{})).statusCode,401);
 assert.equal((await f.post([ids[0]],{cookie:'owner-session',origin:'https://evil.test'})).statusCode,403);
 assert.equal((await f.post([ids[0],ids[0]])).statusCode,422);
 assert.equal((await f.post([ids[2]])).statusCode,422,'other revision');
 assert.equal((await f.post([ids[3]])).statusCode,422,'other project');
 assert.equal((await f.post(['not-a-uuid'])).statusCode,422);
 assert.equal((await f.post(Array(13).fill(ids[0]))).statusCode,422);
 assert.equal(f.saved,0);
 f.brokenId=ids[0];
 assert.equal((await f.post([ids[0]])).statusCode,422,'checksum gate');
 assert.equal(f.saved,0);
 f.brokenId=ids[1];
 // Select a good image, then make it corrupt before anonymous access.
 // Selection is allowed while the image exists.
 assert.equal((await f.post([ids[0]])).statusCode,422);
 assert.equal((await f.post([])).statusCode,303);
 assert.equal((await f.app.inject({method:'GET',url:'/share/'+token+'/renders/'+ids[0]+'.png'})).statusCode,404);
 f.active=false;
 assert.equal((await f.post([])).statusCode,404,'revoked share cannot be updated');
 assert.equal((await f.app.inject({method:'GET',url:'/share/'+token})).statusCode,404);
});
