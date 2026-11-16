import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalArtifactStore, RevisionConflictError } from '../dist/storage/artifact-store.js';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bw-store-'));
  t.after(() => rm(dir, { recursive:true, force:true }));
  const root=path.join(dir,'volume');
  await mkdir(root);
  const source=path.join(dir,'monster.glb');
  await writeFile(source, Buffer.from('glTF-test-artifact-binary'));
  return {root,source,projectId:randomUUID()};
}
test('publishes immutable revision, verifies checksum, survives new instance', async t => {
  const {root,source,projectId}=await fixture(t);
  const store=new LocalArtifactStore(root);
  const one=await store.publish({projectId,revision:1,expectedPreviousRevision:0,
    artifacts:[{name:'monster.glb',sourcePath:source}]});
  assert.equal(one.revision,1);
  assert.match(one.artifacts[0].sha256,/^[0-9a-f]{64}$/);
  const newProcessStore=new LocalArtifactStore(root);
  assert.deepEqual(await newProcessStore.listRevisions(projectId),[1]);
  assert.deepEqual(await newProcessStore.inspect(projectId,1),one);
  const actual=await newProcessStore.verifiedArtifactPath(projectId,1,'monster.glb');
  assert.equal(await readFile(actual,'utf8'),'glTF-test-artifact-binary');
  await assert.rejects(()=>store.publish({projectId,revision:1,expectedPreviousRevision:0,
    artifacts:[{name:'monster.glb',sourcePath:source}]}),RevisionConflictError);
  await writeFile(source,'changed-v2');
  const two=await store.publish({projectId,revision:2,expectedPreviousRevision:1,
    artifacts:[{name:'monster.glb',sourcePath:source}]});
  assert.equal(two.revision,2);
  assert.deepEqual(await store.listRevisions(projectId),[1,2]);
  assert.equal(await readFile(actual,'utf8'),'glTF-test-artifact-binary');
});
test('concurrent publishers cannot overwrite the same revision', async t => {
  const {root,source,projectId}=await fixture(t);
  const store=new LocalArtifactStore(root);
  const outcomes=await Promise.allSettled(Array.from({length:5},()=>store.publish({
    projectId,revision:1,expectedPreviousRevision:0,
    artifacts:[{name:'monster.glb',sourcePath:source}]})));
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(x=>x.status==='rejected').length,4);
  assert.deepEqual(await store.listRevisions(projectId),[1]);
  await store.inspect(projectId,1);
});
test('rejects path traversal, invalid names, stale revision and symbolic sources', async t => {
  const {root,source,projectId}=await fixture(t);
  const store=new LocalArtifactStore(root);
  await assert.rejects(()=>store.publish({projectId:'../outside',revision:1,expectedPreviousRevision:0,artifacts:[{name:'x.glb',sourcePath:source}]}),RangeError);
  await assert.rejects(()=>store.publish({projectId,revision:1,expectedPreviousRevision:0,artifacts:[{name:'../evil.glb',sourcePath:source}]}),RangeError);
  await assert.rejects(()=>store.publish({projectId,revision:2,expectedPreviousRevision:0,artifacts:[{name:'good.glb',sourcePath:source}]}),RevisionConflictError);
  assert.deepEqual(await store.listRevisions(projectId),[]);
});
test('failed write does not publish partial revision and releases lock', async t => {
  const {root,source,projectId}=await fixture(t);
  const store=new LocalArtifactStore(root);
  await assert.rejects(()=>store.publish({projectId,revision:1,expectedPreviousRevision:0,
    artifacts:[{name:'monster.glb',sourcePath:source},{name:'bad.blend',sourcePath:'/unavailable-path'}]}));
  assert.deepEqual(await store.listRevisions(projectId),[]);
  await store.publish({projectId,revision:1,expectedPreviousRevision:0,artifacts:[{name:'monster.glb',sourcePath:source}]});
  assert.deepEqual(await store.listRevisions(projectId),[1]);
});
test('tampered artifact is rejected by verifier', async t => {
  const {root,source,projectId}=await fixture(t);
  const store=new LocalArtifactStore(root);
  await store.publish({projectId,revision:1,expectedPreviousRevision:0,artifacts:[{name:'monster.glb',sourcePath:source}]});
  const filename=await store.verifiedArtifactPath(projectId,1,'monster.glb');
  await writeFile(filename,'malicious-replacement');
  await assert.rejects(()=>store.inspect(projectId,1),/checksum mismatch/);
  await assert.rejects(()=>store.verifiedArtifactPath(projectId,1,'monster.glb'));
});
test('never returns unknown artifact or accepts relative root', async t => {
  assert.throws(()=>new LocalArtifactStore('relative-volume'),RangeError);
  const {root,source,projectId}=await fixture(t);
  const store=new LocalArtifactStore(root);
  await store.publish({projectId,revision:1,expectedPreviousRevision:0,artifacts:[{name:'monster.glb',sourcePath:source}]});
  await assert.rejects(()=>store.verifiedArtifactPath(projectId,1,'other.glb'),/not found/);
});
