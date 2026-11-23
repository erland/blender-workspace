import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../dist/app.js';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';

const ORIGIN='https://blender-workspace.example.test';
const OWNER='oauth:'+'a'.repeat(64),FOREIGN='oauth:'+'b'.repeat(64);
const CSRF='ux-texture-csrf';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'bw-ux-texture-'));
 const projectId=randomUUID(),uploadId=randomUUID(),artifacts=new LocalArtifactStore(root);
 const sceneFile=path.join(root,'scene-report.json');
 const modelFile=path.join(root,'model.blend');
 const currentRevision=3;
 const scene={schema_version:1,scene:{objects:[
   {name:'Head <mesh>',type:'MESH'},
   {name:'Torso',type:'MESH'},
   {name:'Camera',type:'CAMERA'},
   {name:'Hair Curves',type:'CURVES'}
 ]}};
 await writeFile(sceneFile,JSON.stringify(scene));
 await writeFile(modelFile,'BLENDER source artifact for validating mesh selection');
 await artifacts.publish({projectId,revision:1,expectedPreviousRevision:0,
   artifacts:[{name:'scene.json',sourcePath:sceneFile},{name:'scene.blend',sourcePath:modelFile}]});
 // Stub project revision 3 by separately publishing immutable intermediate revisions.
 for(const revision of [2,3]){
  await artifacts.publish({projectId,revision,expectedPreviousRevision:revision-1,
   artifacts:[{name:'scene.json',sourcePath:sceneFile},{name:'scene.blend',sourcePath:modelFile}]});
 }
 const project={id:projectId,name:'Test project',description:'',current_revision:currentRevision,
   updated_at:new Date()};
 let queued=0;
 const app=createApp({authMode:'google',google:{},publicOrigin:ORIGIN,host:'127.0.0.1',port:3000,accessToken:''},{
  projects:{
   async get(owner,id){return owner===OWNER&&id===projectId?project:null;},
   async list(owner){return owner===OWNER?[project]:[];},
   async revisions(owner,id){return owner===OWNER&&id===projectId?[{revision:3,artifact_prefix:'ready'}]:[];}
  },
  jobs:{async reserve(owner,id,revision,note,edit,spec,source,assets){
    assert.equal(owner,OWNER);assert.equal(id,projectId);assert.equal(revision,3);
    assert.equal(assets?.[0]?.texture?.objectName,'Torso');
    queued++;
    return {id:randomUUID(),status:'queued'};
  }},
  uploads:{
   async list(owner){return owner===OWNER?[{id:uploadId,filename:'surface.png',format:'png',size_bytes:250}]:[];},
   async get(owner,id){return owner===OWNER&&id===uploadId?{format:'png'}:null;},
   async verifiedPath(){return {path:'/unused'};}
  },
  artifacts,
  modalAccounts:{async status(){return {connected:true};}}
 },{google:{settingsSession(cookie){return cookie==='owner'?{ownerKey:OWNER,csrf:CSRF}:
                         cookie==='foreign'?{ownerKey:FOREIGN,csrf:CSRF}:undefined;}}});
 t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
 return {app,projectId,uploadId,get queued(){return queued;}};
}

test('UX-002 selected task hides unrelated forms and replaces raw mesh-name input',async t=>{
 const f=await fixture(t);
 const model=await f.app.inject({url:'/models/import?task=model',headers:{cookie:'owner'}});
 assert.equal(model.statusCode,200);
 assert.match(model.body,/Importera modellen/);
 assert.doesNotMatch(model.body,/id="apply-texture-form"/);
 const texture=await f.app.inject({url:'/models/import?task=texture',headers:{cookie:'owner'}});
 assert.equal(texture.statusCode,200);
 assert.match(texture.body,/id="apply-texture-form"/);
 assert.match(texture.body,/name="sourceRevision"/);
 assert.match(texture.body,/id="texture-object" name="objectName" required disabled/);
 assert.doesNotMatch(texture.body,/Mesh-objektets exakta namn|texturen packas i BLEND/);
 assert.doesNotMatch(texture.body,/id="uploaded-model"/);
 assert.match(texture.body,/texture-picker.js/);
});

test('UX-002 owner mesh API reads only verified latest scene objects, escapes in UI',async t=>{
 const f=await fixture(t);
 const url='/models/api/projects/'+f.projectId+'/mesh-objects';
 assert.equal((await f.app.inject({url})).statusCode,401);
 assert.equal((await f.app.inject({url,headers:{cookie:'foreign'}})).statusCode,404);
 const response=await f.app.inject({url,headers:{cookie:'owner'}});
 assert.equal(response.statusCode,200,response.body);
 assert.deepEqual(response.json(),{revision:3,objects:['Head <mesh>','Torso']});
 assert.equal(response.headers['cache-control'],'private, no-store');
 assert.match(response.headers['content-security-policy'],/default-src 'none'/);
 assert.equal((await f.app.inject({url:'/models/api/projects/not-a-uuid/mesh-objects',headers:{cookie:'owner'}})).statusCode,404);
});

test('UX-002 texture submission requires exact current revision, owned mesh, Modal confirmation',async t=>{
 const f=await fixture(t);
 const url='/models/textures/apply';
 const post=(obj,revision,owner='owner',confirmed=true)=>f.app.inject({
  method:'POST',url,headers:{cookie:owner,origin:ORIGIN,
   'content-type':'application/x-www-form-urlencoded'},
  payload:new URLSearchParams({csrf:CSRF,projectId:f.projectId,uploadId:f.uploadId,
   objectName:obj,channel:'baseColor',sourceRevision:String(revision),
   ...(confirmed?{confirm:'yes'}:{})}).toString()
 });
 assert.equal((await post('Torso',3,'foreign')).statusCode,403);
 assert.equal((await post('Torso',3,'owner',false)).statusCode,400);
 assert.equal((await post('Head <mesh>',2)).statusCode,409);
 assert.equal((await post('Missing',3)).statusCode,409);
 assert.equal(f.queued,0);
 const valid=await post('Torso',3);
 assert.equal(valid.statusCode,303,valid.body);
 assert.match(valid.headers.location,/texture_queued/);
 assert.equal(f.queued,1);
});
