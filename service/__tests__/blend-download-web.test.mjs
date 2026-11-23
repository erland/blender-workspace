import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApp} from '../dist/app.js';
import {blendDownloadFilename,portableResourceInfo} from '../dist/web/blend-download.js';

const ORIGIN='https://blender-workspace.example.test';
const PROJECT=randomUUID(),OTHER=randomUUID(),REVISION=15;
const OWNER='oauth:'+'a'.repeat(64),FOREIGN='oauth:'+'b'.repeat(64);
const CSRF='read-only-download-test-csrf';
const URL='/projects/'+PROJECT+'/revisions/'+REVISION+'/download';

function fixture(t){
  let reads=0,badDigest=false,reportStatus='complete';
  const nativeBytes=Buffer.concat([Buffer.from('BLENDER-v450'),Buffer.alloc(100,0x31)]);
  const reports={
    complete:{schemaVersion:1,status:'complete',packedCount:2,
      externalCount:0,externalTypes:[]},
    external:{schemaVersion:1,status:'external',packedCount:1,
      externalCount:2,externalTypes:['images','movieclips']}
  };
  const rootPromise=mkdtemp(path.join(os.tmpdir(),'bw-native-export-'));
  const project={id:PROJECT,name:'R2D2 robot',description:'Local Cycles',
    current_revision:REVISION,updated_at:new Date()};
  const revision={revision:REVISION,artifact_prefix:PROJECT+'/00000015',
    note:'A textured animated robot',created_at:new Date()};
  const google={settingsSession(cookie){
    if(cookie==='session=owner')return {ownerKey:OWNER,csrf:CSRF};
    if(cookie==='session=foreign')return {ownerKey:FOREIGN,csrf:CSRF};
    return undefined;
  }};
  const projects={
    async get(owner,id){return owner===OWNER&&id===PROJECT?project:null;},
    async revisions(owner,id){return owner===OWNER&&id===PROJECT?[revision]:[];},
    async list(){return [];},
  };
  const artifacts={
    async verifiedRevisionResources(){return [];},
    async inspect(){return {artifacts:[
      {name:'scene.blend',sizeBytes:nativeBytes.length},
      {name:'scene.json',sizeBytes:128}
    ]};},
    async readVerifiedSmallArtifact(){
      if(reportStatus==='legacy')return JSON.stringify({stage:'sandbox_python'});
      if(reportStatus==='corrupt')throw new Error('tampered report');
      return JSON.stringify({portableResources:reports[reportStatus]});
    },
    async verifiedArtifactPath(id,rev,name){
      reads++;
      assert.equal(id,PROJECT);assert.equal(rev,REVISION);assert.equal(name,'scene.blend');
      if(badDigest)throw new Error('Artifact checksum mismatch');
      const root=await rootPromise;
      return path.join(root,'scene.blend');
    }
  };
  const app=createApp({authMode:'google',google:{},publicOrigin:ORIGIN,
    host:'127.0.0.1',port:3000,accessToken:''},
    {projects,jobs:{async list(){return [];}},artifacts,
      modalAccounts:{async status(){return {connected:false,needsRenewal:false};},
        async memoryMiB(){return 2048;}}},
    {google});
  t.after(async()=>{await app.close();await rm(await rootPromise,{recursive:true,force:true});});
  const write=async()=>writeFile(path.join(await rootPromise,'scene.blend'),nativeBytes);
  return {app,write,bytes:nativeBytes,get reads(){return reads;},
    set invalidNative(v){badDigest=v;},set status(v){reportStatus=v;}};
}

test('DEV-052 download requires signed owner cookie, valid revision and verified file',async t=>{
  const f=fixture(t);await f.write();
  const unauth=await f.app.inject({method:'GET',url:URL});
  assert.equal(unauth.statusCode,302);
  assert.equal(unauth.headers.location,'/settings/login');
  assert.equal(f.reads,0);
  const foreign=await f.app.inject({method:'GET',url:URL,
    headers:{cookie:'session=foreign'}});
  assert.equal(foreign.statusCode,404);
  assert.equal(f.reads,0);
  const valid=await f.app.inject({method:'GET',url:URL,
    headers:{cookie:'session=owner'}});
  assert.equal(valid.statusCode,200,valid.body);
  assert.deepEqual(valid.rawPayload,f.bytes);
  assert.equal(valid.headers['content-disposition'],
    'attachment; filename="R2D2-robot-rev-15.blend"');
  assert.match(valid.headers['content-type'],/application\/octet-stream/);
  assert.match(valid.headers['cache-control'],/no-store/);
  assert.equal(f.reads,1);
  for(const url of [
    '/projects/'+OTHER+'/revisions/15/download',
    '/projects/'+PROJECT+'/revisions/14/download',
    '/projects/'+PROJECT+'/revisions/0/download',
    '/projects/'+PROJECT+'/revisions/999999999/download'
  ]){
    const res=await f.app.inject({method:'GET',url,headers:{cookie:'session=owner'}});
    assert.equal(res.statusCode,404,url);
  }
  assert.equal(f.reads,1,'Invalid/foreign revisions must not touch storage');
  f.invalidNative=true;
  const tampered=await f.app.inject({method:'GET',url:URL,headers:{cookie:'session=owner'}});
  assert.equal(tampered.statusCode,404);
});

test('DEV-052 history links to native BLEND for every saved revision; status is conservative',async t=>{
  const f=fixture(t);await f.write();
  const page=async()=>{
    const r=await f.app.inject({method:'GET',url:'/projects/'+PROJECT+'?view=history',
      headers:{cookie:'session=owner'}});
    assert.equal(r.statusCode,200,r.body);return r.body;
  };
  let html=await page();
  assert.match(html,/revisions\/15\/download/);
  assert.ok(html.includes('Ladda ned modell (BLEND)'));
  assert.match(html,/Fler val för Revision 15/);
  assert.match(html,/revision-unavailable/);
  assert.doesNotMatch(html,/Kända externa resurser inpackade/);
  f.status='external';
  html=await page();
  assert.ok(html.includes('Ladda ned modell (BLEND)'));
  f.status='legacy';
  html=await page();
  assert.match(html,/Revisionshistorik/);
  f.status='corrupt';
  html=await page();
  assert.match(html,/Revisionshistorik/);
  const foreign=await f.app.inject({method:'GET',url:'/projects/'+PROJECT+'?view=history',
    headers:{cookie:'session=foreign'}});
  assert.equal(foreign.statusCode,404);
});

test('DEV-052 name sanitizer does not allow path traversal, CRLF or header injection',()=>{
  assert.equal(blendDownloadFilename('Å Ä Ö – Robot',15),'A-A-O-Robot-rev-15.blend');
  assert.equal(blendDownloadFilename('../abc\\name"\r\nContent-Disposition: hacked',1),
    'abc-name-Content-Disposition-hacked-rev-1.blend');
  assert.equal(blendDownloadFilename('日本語',2),'Blender-projekt-rev-2.blend');
  assert.ok(blendDownloadFilename('x'.repeat(500),4).length<=85);
  assert.throws(()=>blendDownloadFilename('Good',0),RangeError);
});
test('DEV-052 ignores legacy or adversarial resource metadata',()=>{
  assert.equal(portableResourceInfo({}),undefined);
  assert.equal(portableResourceInfo({portableResources:{
    schemaVersion:1,status:'complete',packedCount:0,externalCount:1,
    externalTypes:[]}}),undefined);
  assert.equal(portableResourceInfo({portableResources:{
    schemaVersion:1,status:'complete',packedCount:0,externalCount:0,
    externalTypes:['unknown-tag']}}),undefined);
  assert.equal(portableResourceInfo({portableResources:{
    schemaVersion:1,status:'external',packedCount:1,externalCount:2,
    externalTypes:['images']}})?.status,'external');
});
