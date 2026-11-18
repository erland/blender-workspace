import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../dist/app.js';
import {loadConfig} from '../dist/config.js';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';

const id=randomUUID();
const config=loadConfig({MCP_ACCESS_TOKEN:'v'.repeat(48),
  MCP_OWNER_KEY:'internal-test',
  PUBLIC_ORIGIN:'http://127.0.0.1:3000'});
const url='/viewer/'+id+'/revisions/1';
const glb='/viewer/api/projects/'+id+'/revisions/1/scene.glb';
const cookie='bw_modal_settings=opaque-signed-session';
const mockGoogle={
  settingsSession(value){
    return value===cookie?{ownerKey:'user-1',csrf:'only-server-visible'}:undefined;
  }
};
test('DEV-019 viewer uses Google cookie and never exposes bearer or session secrets',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-viewer-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const store=new LocalArtifactStore(root),source=path.join(root,'model.glb');
  const bytes=Buffer.from('glTF-test-binary');
  await writeFile(source,bytes);
  await store.publish({projectId:id,revision:1,expectedPreviousRevision:0,
    artifacts:[{name:'scene.glb',sourcePath:source}]});
  await store.publish({projectId:id,revision:2,expectedPreviousRevision:1,
    artifacts:[{name:'scene.glb',sourcePath:source}]});
  const services={
    ownerKey:'internal-test',
    projects:{
      async get(owner,project){return owner==='user-1'&&project===id?{id}:null;},
      async revisions(owner,project){return owner==='user-1'&&project===id?
        [{revision:1,artifact_prefix:id+'/00000001'},
         {revision:2,artifact_prefix:id+'/00000002'}]:[];}
    },
    jobs:{},artifacts:store
  };
  const app=createApp(config,services,{google:mockGoogle});
  t.after(()=>app.close());
  const denied=await app.inject({method:'GET',url});
  assert.equal(denied.statusCode,302);
  assert.equal(denied.headers.location,'/settings/login');
  const missing=await app.inject({method:'GET',url:glb});
  assert.equal(missing.statusCode,401);
  const page=await app.inject({method:'GET',url,headers:{cookie}});
  assert.equal(page.statusCode,200);
  assert.match(page.body,/viewport/);
  assert.match(page.body,/viewer\/assets\/viewer\.js/);
  assert.doesNotMatch(page.body,/opaque-signed-session|only-server-visible|Bearer/);
  assert.match(page.headers['content-security-policy'],/script-src 'self'/);
  const revisionsUrl='/viewer/api/projects/'+id+'/revisions';
  const unauthedList=await app.inject({method:'GET',url:revisionsUrl});
  assert.equal(unauthedList.statusCode,401);
  const list=await app.inject({method:'GET',url:revisionsUrl,headers:{cookie}});
  assert.equal(list.statusCode,200);
  assert.deepEqual(list.json().revisions,[1,2]);
  assert.equal(list.headers['cache-control'],'private, no-store');
  const otherList=await app.inject({method:'GET',
    url:'/viewer/api/projects/'+randomUUID()+'/revisions',headers:{cookie}});
  assert.equal(otherList.statusCode,404);
  const crossOriginList=await app.inject({method:'GET',url:revisionsUrl,
    headers:{cookie,origin:'https://untrusted.example'}});
  assert.equal(crossOriginList.statusCode,403);
  assert.match(page.body,/revision-picker/);
  assert.match(page.body,/comparison-viewport/);
  assert.match(page.body,/copy-selection/);
  const file=await app.inject({method:'GET',url:glb,headers:{cookie}});
  assert.equal(file.statusCode,200);
  assert.equal(file.headers['content-type'],'model/gltf-binary');
  assert.deepEqual(file.rawPayload,bytes);
  assert.equal(file.headers['cache-control'],'private, no-store');
  const forbidden=await app.inject({method:'GET',url:glb,
    headers:{cookie,origin:'https://evil.example'}});
  assert.equal(forbidden.statusCode,403);
  const badRevision=await app.inject({method:'GET',
    url:'/viewer/api/projects/'+id+'/revisions/3/scene.glb',headers:{cookie}});
  assert.equal(badRevision.statusCode,404);
  const foreign=await app.inject({method:'GET',
    url:'/viewer/'+randomUUID()+'/revisions/1',headers:{cookie}});
  assert.equal(foreign.statusCode,404);
  const tampered=await store.verifiedArtifactPath(id,1,'scene.glb');
  await writeFile(tampered,'bad file');
  const corrupt=await app.inject({method:'GET',url:glb,headers:{cookie}});
  assert.equal(corrupt.statusCode,404);
  const listAfterTamper=await app.inject({method:'GET',url:revisionsUrl,headers:{cookie}});
  assert.deepEqual(listAfterTamper.json().revisions,[2]);
});
