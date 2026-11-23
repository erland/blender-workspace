import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/app.js';
import {validateUpload} from '../dist/storage/uploaded-assets.js';
import {parseAssetSources} from '../dist/jobs/asset-sources.js';

const projectId=randomUUID(),uploadId=randomUUID(),csrf='texture-csrf';
const owner='oauth:'+'a'.repeat(64),origin='https://blender-workspace.example.test';

const png=Buffer.alloc(45);
Buffer.from([137,80,78,71,13,10,26,10]).copy(png,0);
png.writeUInt32BE(13,8);png.write('IHDR',12);
png.writeUInt32BE(32,16);png.writeUInt32BE(16,20);png[24]=8;png[25]=6;
const jpeg=Buffer.concat([Buffer.from([255,216,255,192,0,17,8,0,16,0,32,3,1,17,0,2,17,0,3,17,0,255,217]),Buffer.alloc(15)]);

test('DEV-053 image upload validates PNG/JPEG signature, dimensions and names',()=>{
 assert.equal(validateUpload(png,'albedo.png').format,'png');
 assert.equal(validateUpload(jpeg,'skin.jpeg').format,'jpg');
 assert.equal(validateUpload(jpeg,'skin.JPG').format,'jpg');
 assert.throws(()=>validateUpload(Buffer.alloc(64),'fake.png'),/Invalid PNG texture/);
 assert.throws(()=>validateUpload(png,'fake.jpg'),/Invalid JPEG texture/);
 const huge=Buffer.from(png);huge.writeUInt32BE(8193,16);
 assert.throws(()=>validateUpload(huge,'huge.png'),/dimensions/);
 assert.throws(()=>validateUpload(png,'../escape.png'),/filename/);
 assert.throws(()=>validateUpload(png,'image.svg'),/filename/);
});
test('DEV-053 asset-source schema requires explicit mesh and supported channel',()=>{
 const source=[{uploadId,texture:{objectName:'Body',channel:'baseColor'}}];
 assert.deepEqual(parseAssetSources(source),source);
 assert.throws(()=>parseAssetSources([{uploadId,texture:{objectName:'Body',channel:'displacement'}}]));
 assert.throws(()=>parseAssetSources([{uploadId,texture:{objectName:'',channel:'normal'}}]));
 assert.throws(()=>parseAssetSources([...source,...source]),/Duplicate/);
});

test('DEV-053 web image upload is not billable; texture assignment requires CSRF, owner and explicit consent',async t=>{
 let uploads=0,queued=0;
 const google={settingsSession(cookie){
   return cookie==='owner-session'?{ownerKey:owner,csrf}:undefined;
 }};
 const existing={id:projectId,name:'Dinosaur',current_revision:2,
   description:'',created_at:new Date(),updated_at:new Date()};
 const mock={
   projects:{
     async get(o,id){return o===owner&&id===projectId?existing:null;},
     async list(){return [existing];},async revisions(){return [];}
   },
   jobs:{
     async list(){return [];},
     async reserve(o,id,revision,note,_edit,spec,_source,assetSources){
       assert.equal(o,owner);assert.equal(id,projectId);assert.equal(revision,2);
       assert.equal(spec.code,'pass');
       assert.deepEqual(assetSources,[{uploadId,
         texture:{objectName:'Body',channel:'normal'}}]);
       queued++;return {status:'pending'};
     }
   },
   uploads:{
     async list(){return [{id:uploadId,filename:'detail.png',
       format:'png',size_bytes:1024}];},
     async get(o,id){return o===owner&&id===uploadId?
       {id:uploadId,format:'png'}:null;},
     async upload(o,name,data){assert.equal(o,owner);assert.equal(name,'detail.png');
       assert.deepEqual(data,png);uploads++;return {id:uploadId,format:'png'};},
     async verifiedPath(){return {path:'/private/image.png',format:'png'};}
   },
   modalAccounts:{async status(){return {connected:true};}}
 };
 const app=createApp({authMode:'google',google:{},publicOrigin:origin,
   host:'127.0.0.1',port:3000,accessToken:''},mock,{google});
 t.after(()=>app.close());
 const upload=await app.inject({method:'POST',url:'/models/uploads',
   headers:{cookie:'owner-session',origin,'x-csrf-token':csrf,
     'x-model-filename':'detail.png',
     'content-type':'application/vnd.blender-workspace.model'},payload:png});
 assert.equal(upload.statusCode,201,upload.body);
 assert.equal(uploads,1);assert.equal(queued,0);
 const page=await app.inject({method:'GET',url:'/models/import',headers:{cookie:'owner-session'}});
 assert.equal(page.statusCode,200,page.body);
 assert.match(page.body,/Applicera textur i ny revision/);
 const payload=new URLSearchParams({csrf,confirm:'yes',projectId,uploadId,
   objectName:'Body',channel:'normal'}).toString();
 const post=(headers={},data=payload)=>app.inject({method:'POST',url:'/models/textures/apply',
   headers:{'content-type':'application/x-www-form-urlencoded',...headers},payload:data});
 assert.equal((await post()).statusCode,401);
 assert.equal((await post({cookie:'owner-session',origin:'https://evil.test'})).statusCode,403);
 assert.equal((await post({cookie:'owner-session',origin},new URLSearchParams({
   csrf,projectId,uploadId,objectName:'Body',channel:'normal'}).toString())).statusCode,400);
 assert.equal((await post({cookie:'owner-session',origin},
   new URLSearchParams({csrf:'wrong',confirm:'yes',projectId,uploadId,
     objectName:'Body',channel:'normal'}).toString())).statusCode,403);
 assert.equal(queued,0);
 const accepted=await post({cookie:'owner-session',origin});
 assert.equal(accepted.statusCode,303,accepted.body);
 assert.match(accepted.headers.location,/view=history/);
 assert.equal(queued,1);
});
