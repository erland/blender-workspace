import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ContentAddressedResourceStore} from '../dist/storage/content-addressed-resources.js';

async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-cas-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const volume=path.join(root,'volume');
  await mkdir(volume);
  const source=path.join(root,'texture.png');
  const bytes=Buffer.from('same image bytes reused across multiple revisions '+randomUUID());
  await writeFile(source,bytes);
  return {root,volume,source,bytes,store:new ContentAddressedResourceStore(volume)};
}
test('DEV-058 identical texture bytes produce exactly one stored blob',async t=>{
  const f=await fixture(t);
  const [a,b,c]=await Promise.all([f.store.put(f.source),f.store.put(f.source),f.store.put(f.source)]);
  assert.deepEqual(a,b);
  assert.deepEqual(b,c);
  assert.equal(a.sha256,createHash('sha256').update(f.bytes).digest('hex'));
  const shard=path.join(f.volume,'.resources','sha256',a.sha256.slice(0,2));
  assert.deepEqual(await readdir(shard),[a.sha256]);
  const freshInstance=new ContentAddressedResourceStore(f.volume);
  assert.deepEqual(await readFile(await freshInstance.verifiedPath(a)),f.bytes);
});
test('DEV-058 changed bytes create a new resource without replacing the original',async t=>{
  const f=await fixture(t);
  const original=await f.store.put(f.source);
  await writeFile(f.source,'different texture content');
  const newer=await f.store.put(f.source);
  assert.notEqual(original.sha256,newer.sha256);
  assert.deepEqual(await readFile(await f.store.verifiedPath(original)),f.bytes);
  assert.equal((await readFile(await f.store.verifiedPath(newer))).toString(),'different texture content');
});
test('DEV-058 refuses corrupt blobs and rejects invalid content identifiers',async t=>{
  const f=await fixture(t);
  const manifest=await f.store.put(f.source);
  await assert.rejects(()=>f.store.verifiedPath({...manifest,sha256:'../outside'}),RangeError);
  await assert.rejects(()=>f.store.verifiedPath({...manifest,sizeBytes:-1}),RangeError);
  const file=await f.store.verifiedPath(manifest);
  await writeFile(file,'tampered file');
  await assert.rejects(()=>f.store.verifiedPath(manifest),/mismatch|Unsafe/);
  await assert.rejects(()=>f.store.put(f.source),/Corrupt/);
});
test('DEV-058 rejects symlink sources and does not allow relative volume paths',async t=>{
  const f=await fixture(t);
  assert.throws(()=>new ContentAddressedResourceStore('relative'),RangeError);
  const linked=path.join(f.root,'linked.png');
  await symlink(f.source,linked);
  await assert.rejects(()=>f.store.put(linked),RangeError);
  await assert.rejects(()=>f.store.put('/not-existing-resource'),/ENOENT/);
});
