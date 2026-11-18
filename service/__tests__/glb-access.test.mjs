import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../dist/app.js';
import {loadConfig} from '../dist/config.js';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';

const token='g'.repeat(48);
const auth={authorization:'Bearer '+token};
function appFor(owner,projectId,store) {
  const config=loadConfig({MCP_ACCESS_TOKEN:token,MCP_OWNER_KEY:owner,
    PUBLIC_ORIGIN:'http://127.0.0.1:3000'});
  return createApp(config,{
    ownerKey:owner,
    projects:{
      async get(user,id){return user==='owner-a'&&id===projectId?{id,name:'Model',current_revision:1}:null;},
      async revisions(user,id){return user==='owner-a'&&id===projectId?
        [{revision:1,artifact_prefix:id+'/00000001'}]:[];}
    },
    jobs:{},
    artifacts:store
  });
}
test('DEV-018 GLB route requires owner and bearer, and verifies immutable revision bytes',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-glb-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const projectId=randomUUID(),store=new LocalArtifactStore(root);
  const bytes=Buffer.from('glTF-asset-fixture');
  const source=path.join(root,'input.glb');
  await writeFile(source,bytes);
  await store.publish({projectId,revision:1,expectedPreviousRevision:0,
    artifacts:[{name:'scene.glb',sourcePath:source}]});
  const app=appFor('owner-a',projectId,store);
  const other=appFor('owner-b',projectId,store);
  t.after(async()=>{await app.close();await other.close();});
  const url='/api/projects/'+projectId+'/revisions/1/scene.glb';
  const ok=await app.inject({method:'GET',url,headers:auth});
  assert.equal(ok.statusCode,200);
  assert.equal(ok.headers['content-type'],'model/gltf-binary');
  assert.equal(ok.headers['cache-control'],'private, no-store');
  assert.equal(ok.headers['x-content-type-options'],'nosniff');
  assert.deepEqual(ok.rawPayload,bytes);
  const noAuth=await app.inject({method:'GET',url});
  assert.equal(noAuth.statusCode,401);
  const foreign=await other.inject({method:'GET',url,headers:auth});
  assert.equal(foreign.statusCode,404);
  for(const invalid of [
    '/api/projects/../../etc/revisions/1/scene.glb',
    '/api/projects/'+projectId+'/revisions/2/scene.glb',
    '/api/projects/'+projectId+'/revisions/not-a-number/scene.glb',
    '/api/projects/'+randomUUID()+'/revisions/1/scene.glb'
  ]){
    const result=await app.inject({method:'GET',url:invalid,headers:auth});
    assert.notEqual(result.statusCode,200,invalid);
  }
  const saved=await store.verifiedArtifactPath(projectId,1,'scene.glb');
  await writeFile(saved,'tampered');
  const corrupt=await app.inject({method:'GET',url,headers:auth});
  assert.equal(corrupt.statusCode,404);
});
