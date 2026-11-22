import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import pg from 'pg';
import {applyMigrations} from '../dist/db/migrations.js';
import {validateUpload,UploadedAssetStore} from '../dist/storage/uploaded-assets.js';
import {UploadedAssets} from '../dist/jobs/uploaded-assets.js';
import {parseAssetSources} from '../dist/jobs/asset-sources.js';
import {ProjectRepository} from '../dist/db/projects.js';
import {JobRepository,JobConflict} from '../dist/jobs/job-repository.js';
import {JobOrchestrator} from '../dist/jobs/orchestrator.js';

function glb(){
 const doc={asset:{version:'2.0'},scenes:[{nodes:[0]}],nodes:[{mesh:0}],
  meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:0}],
  bufferViews:[],accessors:[{componentType:5126,count:1,type:'VEC3'}]};
 const json=Buffer.from(JSON.stringify(doc));
 const size=Math.ceil(json.length/4)*4;
 const bytes=Buffer.alloc(20+size,0x20);
 bytes.write('glTF',0,'ascii');bytes.writeUInt32LE(2,4);
 bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(size,12);
 bytes.write('JSON',16,'ascii');json.copy(bytes,20);
 return bytes;
}
const blend=Buffer.concat([Buffer.from('BLENDER-v360'),Buffer.alloc(32)]);
test('Compressed native BLEND upload accepts Blender Zstandard envelope without service decompression',()=>{
 const compressed=Buffer.concat([Buffer.from([0x28,0xb5,0x2f,0xfd]),Buffer.alloc(40,0x02)]);
 const accepted=validateUpload(compressed,'hair_nodes-animal_fur_examples(1).blend');
 assert.equal(accepted.format,'blend');
 assert.equal(accepted.sizeBytes,compressed.length);
 assert.match(accepted.sha256,/^[0-9a-f]{64}$/);
 // A signature does not prove that an archive contains readable Blender data;
 // the trusted isolated Blender import is the final semantic validation.
 assert.throws(()=>validateUpload(
   Buffer.concat([Buffer.from([0x29,0xb5,0x2f,0xfd]),Buffer.alloc(40)]),
   'corrupt.blend'),/Unrecognized BLEND header/);
 assert.throws(()=>validateUpload(compressed,'fake.glb'),/Invalid binary GLB/);
});
test('DEV-041 reject fake files, remote GLB references and traversal filenames',()=>{
 assert.equal(validateUpload(glb(),'mesh.glb').format,'glb');
 assert.equal(validateUpload(blend,'scene.blend').format,'blend');
 for(const [buf,name] of [[Buffer.from('not a model '.repeat(3)),'bad.blend'],
  [glb(),'../evil.glb'],[glb(),'evil.obj'],[glb(),'a\\b.glb'],
  [Buffer.alloc(40),'bad.glb'],[blend,'evil.glb']])
  assert.throws(()=>validateUpload(buf,name));
 const doc={asset:{version:'2.0'},nodes:[{}],meshes:[{}],images:[{uri:'https://evil.test/a.png'}]};
 const json=Buffer.from(JSON.stringify(doc));const bytes=Buffer.alloc(20+Math.ceil(json.length/4)*4,32);
 bytes.write('glTF');bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);
 bytes.writeUInt32LE(bytes.length-20,12);bytes.write('JSON',16);json.copy(bytes,20);
 assert.throws(()=>validateUpload(bytes,'evil.glb'),/External/);
 assert.throws(()=>parseAssetSources([{uploadId:randomUUID(),projectId:randomUUID(),revision:1}]));
 assert.equal(parseAssetSources([{uploadId:randomUUID()}]).length,1);
});
test('DEV-041 owner isolation, integrity checks, job import and no implicit Modal calls',
 {skip:!process.env.TEST_DATABASE_URL},async t=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:4});
 await applyMigrations(pool);
 const root=await mkdtemp(path.join(os.tmpdir(),'bw-upload-test-'));
 const store=new UploadedAssetStore(root),uploads=new UploadedAssets(pool,store);
 const projects=new ProjectRepository(pool),jobs=new JobRepository(pool);
 const owner='asset-'+randomUUID(),other='asset-'+randomUUID();
 const project=await projects.create(owner,'Imported model');
 const ids=[];
 t.after(async()=>{
  try{
   await pool.query('DELETE FROM bw_jobs WHERE project_id=$1',[project.id]);
   await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[project.id]);
   await pool.query('DELETE FROM bw_projects WHERE id=$1',[project.id]);
   for(const id of ids)await pool.query('DELETE FROM bw_uploaded_assets WHERE id=$1',[id]);
  }finally{await pool.end();await rm(root,{recursive:true,force:true});}
 });
 const file=await uploads.upload(owner,'outside.glb',glb());ids.push(file.id);
 assert.equal((await uploads.list(owner)).length,1);
 assert.deepEqual(await uploads.list(other),[]);
 assert.equal(await uploads.get(other,file.id),null);
 await assert.rejects(()=>uploads.verifiedPath(other,file.id));
 assert.equal((await readFile((await uploads.verifiedPath(owner,file.id)).path)).toString('hex'),glb().toString('hex'));
 await assert.rejects(()=>jobs.reserve(other,project.id,0,'',undefined,{kind:'python_script',code:'pass'},
   undefined,[{uploadId:file.id}]),JobConflict);
 const job=await jobs.reserve(owner,project.id,0,'',undefined,{kind:'python_script',code:'pass'},
   undefined,[{uploadId:file.id}]);
 assert.equal(job.asset_sources[0].uploadId,file.id);
 const calls=[];
 const exec={async runPythonScript(out,who,rev,script,prior,assets){
  calls.push({who,rev,script,prior,assets});
  await writeFile(path.join(out,'scene.blend'),'BLENDER derived');
  await writeFile(path.join(out,'scene.json'),'{"scene":{"objects":[]}}');
 }};
 const workflow=new JobOrchestrator(jobs,new (await import('../dist/storage/artifact-store.js')).LocalArtifactStore(root),exec,uploads);
 assert.equal((await workflow.execute(owner,job.id)).status,'completed');
 assert.equal((await projects.get(owner,project.id)).current_revision,1);
 assert.equal(calls[0].assets[0].format,'glb');
 assert.equal(calls[0].assets[0].path,(await uploads.verifiedPath(owner,file.id)).path);
 // A tampered second source fails before invoking the paid executor.
 const file2=await uploads.upload(owner,'another.blend',blend);ids.push(file2.id);
 const pending=await jobs.reserve(owner,project.id,1,'',undefined,
  {kind:'python_script',code:'pass'},undefined,[{uploadId:file2.id}]);
 await writeFile((await uploads.verifiedPath(owner,file2.id)).path,'tampered');
 await assert.rejects(()=>workflow.execute(owner,pending.id),/checksum mismatch/i);
 assert.equal(calls.length,1);
 assert.equal((await jobs.get(owner,pending.id)).status,'failed');
});
