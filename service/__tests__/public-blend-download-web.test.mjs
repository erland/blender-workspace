import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../dist/app.js';

const origin='https://blender-workspace.example.test';
const projectId=randomUUID(),otherId=randomUUID(),revision=3;
const owner='oauth:'+'b'.repeat(64),csrf='download-csrf',token='Z'.repeat(43);
const base='/projects/'+projectId+'/revisions/3/share';
const bytes=Buffer.from('BLENDER-v400 test native packed file');
function fixture(t){
 let enabled=false,active=true,valid=true,saveCount=0,allowErrors=false;
 const project={id:projectId,name:'Sphere / test',description:'',
   current_revision:3,created_at:new Date(),updated_at:new Date()};
 const folder=mkdtemp(path.join(os.tmpdir(),'bw-public-blend-'));
 const file=folder.then(d=>path.join(d,'scene.blend'));
 const google={settingsSession(cookie){
   return cookie==='owner-session'?{ownerKey:owner,csrf}:undefined;
 }};
 const shares={
   async owned(){return {created_at:new Date(),revoked_at:active?null:new Date(),
     expires_at:null,allow_download:enabled,selected_render_ids:[]};},
   async resolve(t){return active&&t===token?{owner_key:owner,project_id:projectId,
     revision,project_name:project.name,allow_glb:true,allow_renders:false,
     selected_render_ids:[],allow_download:enabled}:null;},
   async setDownloadPermission(o,p,r,flag){
     assert.equal(o,owner);assert.equal(p,projectId);assert.equal(r,revision);
     if(!active)return false;
     enabled=flag;saveCount++;return true;
   },
   async revoke(){active=false;return true;}
 };
 const artifacts={async verifiedArtifactPath(p,r,name){
   assert.equal(p,projectId);assert.equal(r,revision);
   if(!valid&&name==='scene.blend')throw new Error('Checksum mismatch');
   return await file;
 }};
 const app=createApp({authMode:'google',google:{},publicOrigin:origin,
   host:'127.0.0.1',port:3000,accessToken:''},{
   projects:{
     async get(o,p){return o===owner&&p===projectId?project:null;},
     async revisions(o,p){return o===owner&&p===projectId?
       [{revision,artifact_prefix:'saved'}]:[];}
   },jobs:{async list(){return [];}},
   modalAccounts:{async status(){return {connected:false};}},
   artifacts,publicShares:shares
 },{google});
 t.after(async()=>{await app.close();await rm(await folder,{recursive:true,force:true});});
 const change=(value,headers={cookie:'owner-session',origin})=>app.inject({
   method:'POST',url:base,headers:{...headers,
     'content-type':'application/x-www-form-urlencoded'},
   payload:new URLSearchParams({action:'download',csrf,enabled:value}).toString()
 });
 return {app,file,change,get enabled(){return enabled;},
   get saves(){return saveCount;},set active(v){active=v;},set valid(v){valid=v;}};
}

test('DEV-057 anonymous native download is explicit, verified and immediately revocable',async t=>{
 const f=fixture(t);await writeFile(await f.file,bytes);
 const url='/share/'+token+'/scene.blend';
 assert.equal((await f.app.inject({method:'GET',url})).statusCode,404);
 const page=await f.app.inject({method:'GET',url:'/share/'+token});
 assert.doesNotMatch(page.body,/href="\/share\/[^"]+\/scene.blend"/);
 const ownerPage=await f.app.inject({method:'GET',url:base,
   headers:{cookie:'owner-session'}});
 assert.match(ownerPage.body,/Tillåt BLEND-nedladdning/);
 assert.match(ownerPage.body,/value="no" selected/);
 assert.equal((await f.change('yes')).statusCode,303);
 assert.equal(f.enabled,true);
 const allowed=await f.app.inject({method:'GET',url});
 assert.equal(allowed.statusCode,200,allowed.body);
 assert.deepEqual(allowed.rawPayload,bytes);
 assert.match(allowed.headers['content-disposition'],/attachment; filename=".*rev-3.blend"/);
 assert.equal(allowed.headers['cache-control'],'no-store');
 assert.equal(allowed.headers['referrer-policy'],'no-referrer');
 assert.match((await f.app.inject({method:'GET',url:'/share/'+token})).body,
   /href="\/share\/[^"]+\/scene.blend"/);
 f.valid=false;
 assert.equal((await f.app.inject({method:'GET',url})).statusCode,404,
   'a corrupt file must never be served');
 f.valid=true;
 assert.equal((await f.change('no')).statusCode,303);
 assert.equal((await f.app.inject({method:'GET',url})).statusCode,404);
 assert.equal((await f.change('yes')).statusCode,303);
 f.active=false;
 assert.equal((await f.app.inject({method:'GET',url})).statusCode,404);
 assert.equal((await f.change('no')).statusCode,404);
 assert.equal((await f.app.inject({method:'GET',url:'/share/'+token})).statusCode,404);
});

test('DEV-057 cannot grant download without proper origin, session or valid BLEND',async t=>{
 const f=fixture(t);await writeFile(await f.file,bytes);
 assert.equal((await f.change('yes',{origin})).statusCode,401);
 assert.equal((await f.change('yes',{cookie:'owner-session',origin:'https://evil.test'})).statusCode,403);
 assert.equal((await f.change('invalid')).statusCode,422);
 assert.equal((await f.change('yes')).statusCode,303);
 assert.equal((await f.change('no')).statusCode,303);
 f.valid=false;
 assert.equal((await f.change('yes')).statusCode,422,'no grant with corrupt source');
 assert.equal(f.enabled,false);
 const url='/share/'+token+'/scene.blend';
 assert.equal((await f.app.inject({method:'GET',url})).statusCode,404);
 assert.equal((await f.app.inject({method:'GET',url:'/share/not-a-token/scene.blend'})).statusCode,404);
 assert.equal((await f.app.inject({method:'GET',url:'/share/'+token+'/scene.blend?projectId='+otherId})).statusCode,404);
});
