import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {createApp} from '../dist/app.js';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';

const origin='https://blender-workspace.example.test',token='R'.repeat(43);
const owner='oauth:'+'c'.repeat(64),csrf='portable-zip-csrf';
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'bw-web-portable-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const id=randomUUID(),rev=1,store=new LocalArtifactStore(root);
 const original=path.join(root,'scene-source.blend'),image=path.join(root,'upload.png');
 await writeFile(original,Buffer.from('BLENDER-v420 full portable scene'));
 await writeFile(image,Buffer.from('PNG resource bytes '.repeat(15)));
 const blob=await store.storeResource(image);
 await store.publish({projectId:id,revision:rev,expectedPreviousRevision:0,
   artifacts:[{name:'scene.blend',sourcePath:original}],
   resources:[{name:'resources/'+blob.sha256+'.png',...blob}]});
 const project={id,name:'Textured Ball',current_revision:1};
 let allowed=false,revoked=false;
 const shares={
   async resolve(value){return value===token&&!revoked?{
     project_id:id,revision:rev,owner_key:owner,project_name:project.name,
     allow_download:allowed,allow_renders:false,selected_render_ids:[]}:null;},
   async setDownloadPermission(o,p,r,value){
     assert.equal(o,owner);assert.equal(p,id);assert.equal(r,rev);
     if(revoked)return false;
     allowed=value;return true;
   }
 };
 const app=createApp({authMode:'google',google:{},publicOrigin:origin,
   host:'127.0.0.1',port:3000,accessToken:''},
   {projects:{async get(o,p){return o===owner&&p===id?project:null;},
     async revisions(o,p){return o===owner&&p===id?[{revision:1,artifact_prefix:'saved'}]:[];}},
    jobs:{async list(){return [];}},modalAccounts:{async status(){return {connected:false};}},
    artifacts:store,publicShares:shares},
   {google:{settingsSession(cookie){
     return cookie==='test-owner'?{ownerKey:owner,csrf}:undefined;
   }}});
 t.after(()=>app.close());
 const action=v=>app.inject({method:'POST',url:'/projects/'+id+'/revisions/1/share',
   headers:{origin,cookie:'test-owner','content-type':'application/x-www-form-urlencoded'},
   payload:new URLSearchParams({csrf,action:'download',enabled:v}).toString()});
 return {app,id,store,action,allow:()=>allowed,revoke:()=>{revoked=true;}};
}
function zipNames(bytes){
 const py='import zipfile,sys,io,json;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));print(json.dumps(z.namelist()))';
 return JSON.parse(execFileSync('python3',['-c',py],{input:bytes,encoding:'utf8'}));
}

test('DEV-061 owner ZIP carries external texture and raw BLEND redirects',async t=>{
 const f=await fixture(t),base='/projects/'+f.id+'/revisions/1/download';
 const unauth=await f.app.inject({method:'GET',url:base+'.zip'});
 assert.equal(unauth.statusCode,302);
 const redirected=await f.app.inject({method:'GET',url:base,headers:{cookie:'test-owner'}});
 assert.equal(redirected.statusCode,302);
 assert.match(redirected.headers.location,/download.zip$/);
 const allowed=await f.app.inject({method:'GET',url:base+'.zip',headers:{cookie:'test-owner'}});
 assert.equal(allowed.statusCode,200,allowed.body);
 assert.deepEqual(zipNames(allowed.rawPayload).sort(),[
  'scene.blend','blender-workspace-resources.json','README.txt',
  (await f.store.inspect(f.id,1)).resources[0].name].sort());
});

test('DEV-061 public ZIP requires active opt-in; raw BLEND never exposes incomplete revision',async t=>{
 const f=await fixture(t);
 const zip='/share/'+token+'/scene.zip',raw='/share/'+token+'/scene.blend';
 assert.equal((await f.app.inject({method:'GET',url:zip})).statusCode,404);
 assert.equal((await f.app.inject({method:'GET',url:raw})).statusCode,404);
 assert.equal((await f.app.inject({method:'GET',url:zip.replace(token,'invalid')})).statusCode,404);
 assert.equal((await f.action('yes')).statusCode,303);
 assert.equal(f.allow(),true);
 const result=await f.app.inject({method:'GET',url:zip});
 assert.equal(result.statusCode,200,result.body);
 assert.equal(zipNames(result.rawPayload).length,4);
 assert.equal((await f.app.inject({method:'GET',url:raw})).statusCode,404);
 assert.equal((await f.action('no')).statusCode,303);
 assert.equal((await f.app.inject({method:'GET',url:zip})).statusCode,404);
 assert.equal((await f.action('yes')).statusCode,303);
 f.revoke();
 assert.equal((await f.app.inject({method:'GET',url:zip})).statusCode,404);
});
