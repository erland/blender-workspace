import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/app.js';

const origin='https://blender-workspace.example.test';
const projectId=randomUUID(),revision=3;
const owner='oauth:'+'a'.repeat(64);
const csrf='session-share-csrf';
const base='/projects/'+projectId+'/revisions/3/share';
const binary=Buffer.concat([Buffer.from('glTF'),Buffer.alloc(70)]);
function fixture(t){
 let active=false,token='',created=0,revoked=0,accessed=0;
 let hasArtifact=true;
 const project={id:projectId,name:'Robot <special>',description:'private description',
   current_revision:4,updated_at:new Date(),created_at:new Date()};
 const revisions=[{revision:3,artifact_prefix:'saved',note:'Publish candidate',
   created_at:new Date()}];
 const google={settingsSession(cookie){return cookie==='owner-session'?
   {ownerKey:owner,csrf}:undefined;}};
 const shares={
   async create(user,id,rev){
     assert.equal(user,owner);assert.equal(id,projectId);assert.equal(rev,3);
     active=true;token='X'.repeat(43);created++;return {token};
   },
   async owned(user,id,rev){
     if(user!==owner||id!==projectId||rev!==3||!created)return null;
     return {project_id:id,revision:3,created_at:new Date(),
       expires_at:null,revoked_at:active?null:new Date()};
   },
   async revoke(user,id,rev){
     assert.equal(user,owner);assert.equal(id,projectId);assert.equal(rev,3);
     if(!active)return false;active=false;revoked++;return true;
   },
   async resolve(input){
     if(!active||input!==token)return null;
     return {project_id:projectId,revision:3,owner_key:owner,
       project_name:project.name,project_description:project.description,
       allow_glb:true,allow_renders:false,allow_download:false,
       selected_render_ids:[]};
   }
 };
 const app=createApp({authMode:'google',google:{},publicOrigin:origin,
   host:'127.0.0.1',port:3000,accessToken:''},
   {projects:{
     async get(user,id){return user===owner&&id===projectId?project:null;},
     async revisions(user,id){return user===owner&&id===projectId?revisions:[];},
     async list(){return [];}
   },jobs:{async list(){return [];}},
   modalAccounts:{async status(){return {connected:false};},async memoryMiB(){return 2048;}},
   artifacts:{
     async verifiedArtifactPath(id,rev,name){
       assert.equal(id,projectId);assert.equal(rev,3);assert.equal(name,'scene.glb');
       accessed++;
       if(!hasArtifact)throw new Error('Checksum mismatch');
       // Fake path is only used for HTML/permission tests, never for the
       // binary download test (which exercises the access gate).
       return '/tmp/verified-public-test-glb';
     },
     async inspect(){return {artifacts:[{name:'scene.glb',sizeBytes:binary.length,sha256:'a'.repeat(64)}]};}
   },publicShares:shares},{google});
 t.after(()=>app.close());
 const post=(body,headers={})=>app.inject({method:'POST',url:base,
   headers:{'content-type':'application/x-www-form-urlencoded',...headers},
   payload:new URLSearchParams(body).toString()});
 return {app,post,get created(){return created;},get revoked(){return revoked;},
   get accessed(){return accessed;},set artifactAvailable(v){hasArtifact=v;},get token(){return token;}};
}
test('DEV-055 requires owner, origin and CSRF before publishing',async t=>{
 const f=fixture(t);
 const body={csrf,action:'publish'};
 assert.equal((await f.post(body)).statusCode,401);
 assert.equal((await f.post(body,{cookie:'foreign-session',origin})).statusCode,401);
 assert.equal((await f.post(body,{cookie:'owner-session',origin:'https://evil.test'})).statusCode,403);
 assert.equal((await f.post({...body,csrf:'wrong'},{cookie:'owner-session',origin})).statusCode,403);
 assert.equal((await f.post({csrf},{cookie:'owner-session',origin})).statusCode,400);
 assert.equal(f.created,0);assert.equal(f.accessed,0);
 const result=await f.post(body,{cookie:'owner-session',origin});
 assert.equal(result.statusCode,200,result.body);
 assert.match(result.body,/share\/X{43}/);
 assert.doesNotMatch(result.body,/<special>/);
 assert.equal(f.created,1);
 assert.equal(f.accessed,1);
 assert.match(result.headers['cache-control'],/no-store/);
});
test('DEV-055 public viewer is read-only, token-scoped, does not leak metadata and is revocable',async t=>{
 const f=fixture(t);
 await f.post({csrf,action:'publish'},{cookie:'owner-session',origin});
 const publicUrl='/share/'+f.token;
 const unauthorized=await f.app.inject({method:'GET',url:publicUrl});
 assert.equal(unauthorized.statusCode,200,unauthorized.body);
 assert.match(unauthorized.body,/Robot &lt;special&gt;/);
 assert.match(unauthorized.body,/revision 3/);
 assert.doesNotMatch(unauthorized.body,/private description/);
 assert.doesNotMatch(unauthorized.body,/render-current-view|scene.blend|Modal-inställningar|projectId/);
 assert.match(unauthorized.headers['x-robots-tag'],/noindex/);
 const js=await f.app.inject({method:'GET',url:'/share/assets/public-viewer.js'});
 assert.equal(js.statusCode,200);
 assert.equal((await f.app.inject({method:'GET',url:'/share/'+('Y'.repeat(43))})).statusCode,404);
 assert.equal((await f.app.inject({method:'GET',url:'/share/'+f.token+'/renders'})).statusCode,404);
 assert.equal((await f.app.inject({method:'GET',url:'/share/'+f.token+'/download'})).statusCode,404);
 const revoke=await f.post({csrf,action:'revoke'},{cookie:'owner-session',origin});
 assert.equal(revoke.statusCode,200);
 assert.equal(f.revoked,1);
 assert.equal((await f.app.inject({method:'GET',url:publicUrl})).statusCode,404);
 assert.equal((await f.app.inject({method:'GET',url:publicUrl+'/scene.glb'})).statusCode,404);
});
test('DEV-055 missing original GLB cannot be published or viewed',async t=>{
 const f=fixture(t);
 f.artifactAvailable=false;
 const result=await f.post({csrf,action:'publish'},{cookie:'owner-session',origin});
 assert.equal(result.statusCode,404);
 assert.equal(f.created,0);
});
