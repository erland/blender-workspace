import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../dist/app.js';
import {viewerDimensions,validateViewerCamera} from '../dist/jobs/viewer-camera.js';
import {validateRenderOptions,RenderJobRepository} from '../dist/jobs/render-repository.js';
import {applyMigrations} from '../dist/db/migrations.js';
import {ProjectRepository} from '../dist/db/projects.js';

const PROJECT=randomUUID(),RENDER=randomUUID();
const OWNER='oauth:'+'a'.repeat(64),OTHER='oauth:'+'b'.repeat(64),CSRF='viewer-csrf';
const ORIGIN='https://blender-workspace.apphome.one';
const camera={type:'perspective',position:[3,4,5],target:[0,0,0],
 up:[0,1,0],verticalFovDegrees:45};
const google={
 settingsSession(cookie){return cookie==='session=owner'?{ownerKey:OWNER,csrf:CSRF}:
   cookie==='session=other'?{ownerKey:OTHER,csrf:CSRF}:undefined;},
 beginSettingsLogin(){return {status:302,body:'',headers:{location:'/settings/login'}};},
 metadata(){return {};},jwks:{keys:[]}
};
test('viewer render camera and short-edge dimensions are constrained',()=>{
 assert.deepEqual(viewerDimensions(16,9),{width:910,height:512});
 assert.deepEqual(viewerDimensions(9,16),{width:512,height:910});
 assert.deepEqual(viewerDimensions(1,1),{width:512,height:512});
 assert.deepEqual(viewerDimensions(4,1),{width:2048,height:512});
 assert.deepEqual(viewerDimensions(1,4),{width:512,height:2048});
 assert.deepEqual(validateViewerCamera(camera),camera);
 for(const bad of [
   {...camera,position:[0,0,0]}, {...camera,up:[0,0,0]},
   {...camera,up:[3,4,5]}, {...camera,verticalFovDegrees:180},
   {...camera,position:[Infinity,1,2]}, {...camera,type:'orthographic'},
   {...camera,script:'print(1)'}
 ])assert.throws(()=>validateViewerCamera(bad),RangeError);
 assert.throws(()=>viewerDimensions(10000,1),RangeError);
 assert.throws(()=>validateRenderOptions({engine:'CYCLES',width:910,height:512,samples:16}),RangeError);
 assert.deepEqual(validateRenderOptions({
   engine:'CYCLES',width:910,height:512,samples:16,requestedFrom:'viewer',camera
 }),{engine:'CYCLES',width:910,height:512,samples:16,requestedFrom:'viewer',camera});
 assert.throws(()=>validateRenderOptions({engine:'CYCLES',width:455,height:256,samples:16,requestedFrom:'viewer',camera}),RangeError);
 assert.deepEqual(validateRenderOptions({engine:'CYCLES',width:2048,height:512,samples:16,requestedFrom:'viewer',camera}),{engine:'CYCLES',width:2048,height:512,samples:16,requestedFrom:'viewer',camera});
});
test('viewer render request requires explicit authenticated CSRF-protected action',async t=>{
 let queued=0,reads=0;
 const app=createApp({authMode:'google',google:{},publicOrigin:ORIGIN,
   host:'127.0.0.1',port:3000,accessToken:''},{
   projects:{
     async get(owner,id){return owner===OWNER&&id===PROJECT?{id:PROJECT}:null;},
     async revisions(owner,id){return owner===OWNER&&id===PROJECT?
       [{revision:1,artifact_prefix:PROJECT+'/00000001'}]:[];}
   },jobs:{},
   artifacts:{async verifiedArtifactPath(){return '/dev/null';}},
   modalAccounts:{async status(){return {connected:true,needsRenewal:false};}},
   renderJobs:{
     async reserve(owner,id,revision,options){
       queued++;assert.equal(owner,OWNER);assert.equal(id,PROJECT);
       assert.equal(revision,1);
       assert.deepEqual(options,{engine:'CYCLES',width:910,height:512,samples:16,
         requestedFrom:'viewer',camera});
       return {id:RENDER};
     },
     async list(owner,id,revision){reads++;
       assert.equal(owner,OWNER);assert.equal(id,PROJECT);assert.equal(revision,1);
       return [{id:RENDER,source_revision:1,status:'completed',engine:'CYCLES',
         width:910,height:512,samples:16,requested_from:'viewer',
         created_at:new Date(),error_code:null}];
     }
   }
 },{google});
 t.after(()=>app.close());
 const url='/viewer/api/projects/'+PROJECT+'/revisions/1/renders';
 const post=(headers={},body={})=>app.inject({method:'POST',url,headers:{
   cookie:'session=owner',origin:ORIGIN,'content-type':'application/json',
   'x-csrf-token':CSRF,...headers},
   payload:JSON.stringify({camera,viewportWidth:16,viewportHeight:9,...body})});
 assert.equal((await app.inject({method:'GET',url})).statusCode,401);
 assert.equal((await post({cookie:'session=other'})).statusCode,404);
 assert.equal((await post({origin:'https://bad.example'})).statusCode,403);
 assert.equal((await post({'x-csrf-token':'wrong'})).statusCode,403);
 assert.equal((await post({cookie:''})).statusCode,401);
 assert.equal((await post({}, {viewportWidth:100000})).statusCode,422);
 assert.equal((await post({}, {camera:{...camera,position:[0,0,0]}})).statusCode,422);
 assert.equal(queued,0);
 const status=await app.inject({method:'GET',url,headers:{cookie:'session=owner'}});
 assert.equal(status.statusCode,200);
 assert.equal(status.json().csrf,CSRF);
 assert.equal(status.json().renders[0].requestedFrom,'viewer');
 assert.match(status.json().renders[0].imageUrl,/\/renders\//);
 assert.equal(reads,1);
 assert.equal((await app.inject({method:'GET',url,headers:{
   cookie:'session=other'}})).statusCode,404);
 const page=await app.inject({method:'GET',
   url:'/viewer/'+PROJECT+'/revisions/1',headers:{cookie:'session=owner'}});
 assert.equal(page.statusCode,200);
 assert.match(page.body,/render-current-view/);
 assert.match(page.body,/render-history/);
 assert.doesNotMatch(page.body,/viewer-csrf/);
 const response=await post();
 assert.equal(response.statusCode,202);
 assert.equal(response.json().jobId,RENDER);
 assert.equal(queued,1);
});
test('viewer camera and source are stored on the original revision', {skip:!process.env.TEST_DATABASE_URL},async t=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:4});
 await applyMigrations(pool);
 const projects=new ProjectRepository(pool),jobs=new RenderJobRepository(pool);
 const owner='viewer-'+randomUUID(),p=await projects.create(owner,'Viewer camera');
 t.after(async()=>{
   try{
     await pool.query('DELETE FROM bw_render_jobs WHERE project_id=$1',[p.id]);
     await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[p.id]);
     await pool.query('DELETE FROM bw_projects WHERE id=$1',[p.id]);
   }finally{await pool.end();}
 });
 await projects.addRevision(owner,p.id,'Original',p.id+'/00000001');
 const queued=await jobs.reserve(owner,p.id,1,{engine:'CYCLES',width:910,height:512,
   samples:16,requestedFrom:'viewer',camera});
 const stored=await jobs.get(owner,queued.id);
 assert.equal(stored.source_revision,1);
 assert.equal(stored.requested_from,'viewer');
 assert.deepEqual(stored.camera_override,camera);
 assert.equal((await jobs.list(owner,p.id,1)).length,1);
 assert.equal((await jobs.list('other-owner',p.id,1)).length,0);
 assert.equal((await projects.get(owner,p.id)).current_revision,1);
});
