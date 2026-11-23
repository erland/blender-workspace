import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/app.js';
import {loadConfig} from '../dist/config.js';
import {validateUpload} from '../dist/storage/uploaded-assets.js';

test('DEV-054 MCP tool accepts a private PNG and returns owner-scoped texture uploadId without queuing Modal',async t=>{
 const owner='mcp-texture-test-'+randomUUID(),token='k'.repeat(48);
 const filename='skin.png';
 const image=Buffer.alloc(45);
 Buffer.from([137,80,78,71,13,10,26,10]).copy(image);
 image.writeUInt32BE(13,8);
 image.write('IHDR',12);
 image.writeUInt32BE(16,16);
 image.writeUInt32BE(16,20);
 image[24]=8;image[25]=6;
 const uploadedId=randomUUID();
 let uploads=0,queued=0;
 const app=createApp(loadConfig({
   MCP_ACCESS_TOKEN:token,MCP_OWNER_KEY:owner,
   PUBLIC_ORIGIN:'http://127.0.0.1:3000'
 }),{
   ownerKey:owner,
   projects:{async list(){return [];}},
   jobs:{async reserve(){queued++;throw new Error('Modal must not run');}},
   uploads:{
     async upload(actualOwner,actualName,bytes){
       assert.equal(actualOwner,owner);
       assert.equal(actualName,filename);
       assert.deepEqual(bytes,image);
       assert.equal(validateUpload(bytes,actualName).format,'png');
       uploads++;
       return {id:uploadedId,filename,format:'png',size_bytes:bytes.length,
         sha256:'f'.repeat(64),created_at:new Date()};
     },
     async list(){return [];},
     async get(){return null;},
     async verifiedPath(){throw new Error('not called');}
   }
 });
 await app.listen({port:0,host:'127.0.0.1'});
 t.after(()=>app.close());
 let n=0;
 const call=async(name,args,authenticated=true)=>{
   const response=await fetch('http://127.0.0.1:'+app.server.address().port+'/mcp',{
     method:'POST',headers:{
       'content-type':'application/json',
       accept:'application/json, text/event-stream',
       ...(authenticated?{authorization:'Bearer '+token}:{})
     },body:JSON.stringify({jsonrpc:'2.0',id:++n,
       method:name==='list'?'tools/list':'tools/call',
       params:name==='list'?{}:{name,arguments:args}})
   });
   const raw=await response.text();
   if(!authenticated)return {status:response.status};
   assert.equal(response.status,200,raw);
   const line=raw.split('\n').find(l=>l.startsWith('data:'));
   const obj=JSON.parse(line?line.slice(5):raw);
   return obj.result;
 };
 const names=(await call('list',{})).tools.map(x=>x.name);
 assert.ok(names.includes('workspace_upload_texture'));
 assert.equal((await call('workspace_upload_texture',{
   filename,textureBase64:image.toString('base64')
 })).content[0].text.includes(uploadedId),true);
 assert.equal(uploads,1);
 assert.equal(queued,0);
 const invalid=await call('workspace_upload_texture',{
   filename:'bad.blend',textureBase64:image.toString('base64')
 });
 assert.equal(invalid.isError,true);
 assert.equal(uploads,1);
 assert.equal((await call('workspace_upload_texture',{
   file:{download_url:'https://file.example.test/a',file_id:'abc'},
   filename,textureBase64:image.toString('base64')
 })).isError,true);
 assert.equal(uploads,1);
 assert.equal((await call('workspace_upload_texture',{filename,
   textureBase64:image.toString('base64')},false)).status,401);
});
