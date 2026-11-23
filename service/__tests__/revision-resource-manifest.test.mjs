import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';
import {ContentAddressedResourceStore} from '../dist/storage/content-addressed-resources.js';

async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-revision-resources-'));
  t.after(()=>rm(root,{force:true,recursive:true}));
  const volume=path.join(root,'volume');
  await mkdir(volume);
  const scene=path.join(root,'scene.blend');
  const texture=path.join(root,'texture.png');
  await writeFile(scene,'original geometry with relative texture path');
  await writeFile(texture,'unchanging image bytes');
  const cas=new ContentAddressedResourceStore(volume);
  const store=new LocalArtifactStore(volume);
  const ref=await cas.put(texture);
  const projectId=randomUUID();
  const description={name:'resources/stone.png',...ref};
  const publish=(revision,resources=[description])=>store.publish({
    projectId,revision,expectedPreviousRevision:revision-1,
    artifacts:[{name:'scene.blend',sourcePath:scene}],resources
  });
  return {root,volume,scene,texture,cas,store,ref,projectId,description,publish};
}

test('DEV-059 revisions share immutable SHA-256 bytes without duplicate copies',async t=>{
  const f=await fixture(t);
  const first=await f.publish(1);
  const second=await f.publish(2);
  assert.deepEqual(first.resources,[f.description]);
  assert.deepEqual(second.resources,[f.description]);
  const paths=await f.store.verifiedRevisionResources(f.projectId,1);
  assert.equal(paths.length,1);
  assert.equal(paths[0].name,'resources/stone.png');
  assert.equal((await readFile(paths[0].path)).toString(),'unchanging image bytes');
  assert.deepEqual((await f.store.inspect(f.projectId,2)).resources,[f.description]);
  const third=await f.publish(3,[]);
  assert.deepEqual(third.resources,[]);
  assert.deepEqual(await f.store.verifiedRevisionResources(f.projectId,3),[]);
});

test('DEV-059 rejects missing resources and does not publish a partial revision',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.publish(1,[{...f.description,sha256:'f'.repeat(64)}]));
  assert.deepEqual(await f.store.listRevisions(f.projectId),[]);
  await f.publish(1);
  const paths=await f.store.verifiedRevisionResources(f.projectId,1);
  await writeFile(paths[0].path,'tampered image');
  await assert.rejects(()=>f.store.inspect(f.projectId,1),/mismatch|Unsafe/);
  await assert.rejects(()=>f.store.verifiedRevisionResources(f.projectId,1));
  await assert.rejects(f.publish(2));
  assert.deepEqual(await f.store.listRevisions(f.projectId),[1]);
});

test('DEV-059 refuses unsafe logical paths, duplicate case variants and malformed metadata',async t=>{
  const f=await fixture(t);
  const bad=['../secret.png','/tmp/texture.png','resources/../../secret.png',
    'resources/a\\b.png','resources/space name.png','resources/a.png/another','resources/.png'];
  for(const name of bad){
    await assert.rejects(f.publish(1,[{...f.description,name}]),RangeError,name);
  }
  await assert.rejects(f.publish(1,[f.description,{...f.description,name:'resources/STONE.png'}]),RangeError);
  await assert.rejects(f.publish(1,[{...f.description,sha256:'not-a-hash'}]),RangeError);
  await assert.rejects(f.publish(1,[{...f.description,sizeBytes:-1}]),RangeError);
  await assert.rejects(f.publish(1,[{...f.description,sourcePath:'/tmp/leak'}]),RangeError);
  assert.deepEqual(await f.store.listRevisions(f.projectId),[]);
});

test('DEV-059 verifies tampered revision manifest resources rather than trusting JSON',async t=>{
  const f=await fixture(t);
  await f.publish(1);
  const file=path.join(f.volume,f.projectId,'00000001','manifest.json');
  const doc=JSON.parse(await readFile(file,'utf8'));
  doc.resources=[{...f.description,name:'resources/../../private.png'}];
  await writeFile(file,JSON.stringify(doc));
  await assert.rejects(()=>f.store.inspect(f.projectId,1),RangeError);
});

test('DEV-059 resource-free revisions continue to publish and inspect normally',async t=>{
  const f=await fixture(t);
  await f.store.publish({projectId:f.projectId,revision:1,expectedPreviousRevision:0,
    artifacts:[{name:'scene.blend',sourcePath:f.scene}]});
  assert.deepEqual((await f.store.inspect(f.projectId,1)).resources,[]);
});
