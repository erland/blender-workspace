import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/app.js';

const ORIGIN='https://blender-workspace.example.test';
const OWNER='oauth:'+'a'.repeat(64),FOREIGN='oauth:'+'b'.repeat(64);
const CSRF='testing-csrf',projectId=randomUUID(),uploadId=randomUUID();
function fixture(t){
 let uploaded=0,queued=0,created=0;
 const google={settingsSession(cookie){
  return cookie==='cookie=owner'?{ownerKey:OWNER,csrf:CSRF}:
    cookie==='cookie=other'?{ownerKey:FOREIGN,csrf:CSRF}:undefined;
 }};
 const existing={id:projectId,name:'Existing',description:'',current_revision:4,
  updated_at:new Date(),created_at:new Date()};
 const uploads={
  async list(owner){return owner===OWNER?[{id:uploadId,filename:'Model.glb',
    format:'glb',size_bytes:192}]:[];},
  async upload(owner,filename,bytes){
   assert.equal(owner,OWNER);assert.equal(filename,'Model.glb');
   assert.equal(Buffer.isBuffer(bytes),true);uploaded++;
   return {id:uploadId,format:'glb'};
  },
  async verifiedPath(owner,id){
   if(owner!==OWNER||id!==uploadId)throw new Error('Not found');
   return {path:'/private/model.glb',format:'glb'};
  }
 };
 const projects={
  async get(owner,id){return owner===OWNER&&id===projectId?existing:null;},
  async list(owner){return owner===OWNER?[existing]:[];},
  async revisions(){return [];},
  async create(owner,name){
   assert.equal(owner,OWNER);created++;
   return {id:randomUUID(),name,description:'',current_revision:0};
  }
 };
 const jobs={async reserve(owner,id,rev,note,edit,spec,source,assets){
  queued++;assert.equal(owner,OWNER);assert.equal(id,projectId);
  assert.equal(rev,4);assert.equal(spec.code,'pass');
  assert.deepEqual(assets,[{uploadId,offset:[0,0,0]}]);
  return {id:randomUUID(),status:'pending',requested_revision:5};
 }};
 const app=createApp({authMode:'google',google:{},publicOrigin:ORIGIN,
  host:'127.0.0.1',port:3000,accessToken:''},
  {projects,jobs,uploads,modalAccounts:{
    async status(){return {connected:true};}
  }},{google});
 t.after(()=>app.close());
 return {app,get uploaded(){return uploaded;},get queued(){return queued;},get created(){return created;}};
}
test('DEV-041 model uploads require session, origin, CSRF and correct binary type',async t=>{
 const f=fixture(t),app=f.app;
 const req=headers=>app.inject({method:'POST',url:'/models/uploads',payload:Buffer.alloc(64),
  headers:{'content-type':'application/vnd.blender-workspace.model',
   'x-model-filename':'Model.glb',...headers}});
 assert.equal((await req({})).statusCode,401);
 assert.equal((await req({cookie:'cookie=owner',origin:'https://evil.test',
  'x-csrf-token':CSRF})).statusCode,403);
 assert.equal((await req({cookie:'cookie=owner',origin:ORIGIN,
  'x-csrf-token':'bad'})).statusCode,403);
 assert.equal((await req({cookie:'cookie=owner',origin:'null',
  'sec-fetch-site':'cross-site','x-csrf-token':CSRF})).statusCode,403);
 assert.equal((await req({cookie:'cookie=owner',origin:ORIGIN,
  'x-csrf-token':CSRF,'content-type':'application/octet-stream'})).statusCode,415);
 assert.equal(f.uploaded,0);
 const result=await req({cookie:'cookie=owner',origin:ORIGIN,'x-csrf-token':CSRF});
 assert.equal(result.statusCode,201,result.body);
 assert.equal(result.json().uploadId,uploadId);
 assert.equal(f.uploaded,1);
 assert.equal(f.queued,0);
 const page=await app.inject({method:'GET',url:'/models/import',headers:{cookie:'cookie=owner'}});
 assert.equal(page.statusCode,200);
 assert.match(page.body,/id="upload-model-form"/);
 assert.match(page.body,/Modell.glb|Model.glb/);
 assert.match(page.headers['content-security-policy'],/connect-src 'self'/);
 assert.equal((await app.inject({method:'GET',url:'/models/import'})).statusCode,302);
 const landing=await app.inject({method:'GET',url:'/',headers:{cookie:'cookie=owner'}});
 assert.match(landing.body,/href="\/models\/import"/);
});
test('DEV-041 only explicitly confirmed owner import can reserve billable job',async t=>{
 const f=fixture(t),app=f.app;
 const body=new URLSearchParams({csrf:CSRF,confirm:'yes',
   uploadId,projectId,name:'Ignored'}).toString();
 const req=(payload=body,headers={})=>app.inject({method:'POST',url:'/models/compose',
  payload,headers:{'content-type':'application/x-www-form-urlencoded',...headers}});
 assert.equal((await req()).statusCode,401);
 assert.equal((await req(body,{cookie:'cookie=owner',origin:'https://evil.test'})).statusCode,403);
 assert.equal((await req(body,{cookie:'cookie=owner',origin:ORIGIN,
  })).statusCode,303);
 // CSRF is inside form body and preserved across Safari same-origin requests.
 assert.equal(f.queued,1);
 assert.equal(f.created,0);
 const notConfirmed=new URLSearchParams({csrf:CSRF,uploadId,projectId}).toString();
 assert.equal((await req(notConfirmed,{cookie:'cookie=owner',origin:ORIGIN})).statusCode,400);
 const wrongCsrf=new URLSearchParams({csrf:'bad',uploadId,projectId,confirm:'yes'}).toString();
 assert.equal((await req(wrongCsrf,{cookie:'cookie=owner',origin:ORIGIN})).statusCode,403);
 assert.equal(f.queued,1);
});
