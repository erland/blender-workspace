import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {applyMigrations} from '../dist/db/migrations.js';
import {ProjectRepository} from '../dist/db/projects.js';
import {JobRepository,JobConflict} from '../dist/jobs/job-repository.js';
import {JobOrchestrator} from '../dist/jobs/orchestrator.js';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';
import {parseAssetSources} from '../dist/jobs/asset-sources.js';

const spec={kind:'python_script',code:'pass'};
test('DEV-040 model source input validation disallows path injection, duplicates and unbounded arrays',()=>{
 const id=randomUUID(),other=randomUUID();
 assert.deepEqual(parseAssetSources([{projectId:id,revision:1}]),
  [{projectId:id,revision:1,offset:[0,0,0]}]);
 for(const input of [
  [{projectId:id,revision:1,offset:[NaN,0,0]}],
  [{projectId:id,revision:1,offset:[100001,0,0]}],
  [{projectId:id,revision:0}],
  [{projectId:id,revision:1,path:'/etc/passwd'}],
  [{projectId:id,revision:1},{projectId:id,revision:1}],
  Array.from({length:5},(_,i)=>({projectId:i%2?id:other,revision:i+1}))
 ])assert.throws(()=>parseAssetSources(input));
});

test('DEV-040 owner checks, locked destination, immutable source paths and pre-billing validation',
 {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:5});
  await applyMigrations(pool);
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-compose-'));
  const owner='compose-'+randomUUID(),other='not-owner-'+randomUUID();
  const projects=new ProjectRepository(pool),jobs=new JobRepository(pool),
        files=new LocalArtifactStore(root);
  const targets=[
   await projects.create(owner,'Scene'),
   await projects.create(owner,'Rex'),
   await projects.create(owner,'Cat'),
   await projects.create(other,'Private asset')
  ];
  t.after(async()=>{
   try{
    for(const p of targets){
     await pool.query('DELETE FROM bw_jobs WHERE project_id=$1',[p.id]);
     await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[p.id]);
     await pool.query('DELETE FROM bw_projects WHERE id=$1',[p.id]);
    }
   }finally{await pool.end();await rm(root,{recursive:true,force:true});}
  });
  for(const p of targets.slice(1)){
   const file=path.join(root,p.id+'.blend');
   await writeFile(file,'BLENDER generated for '+p.id);
   await files.publish({projectId:p.id,revision:1,expectedPreviousRevision:0,
     artifacts:[{name:'scene.blend',sourcePath:file}]});
   await projects.addRevision(p.owner_key,p.id,'Scene',p.id+'/00000001');
  }
  const sources=targets.slice(1,3).map((p,i)=>({projectId:p.id,revision:1,
   offset:[i*6,0,0]}));
  await assert.rejects(()=>jobs.reserve(owner,targets[0].id,0,'',undefined,spec,
    undefined,[{projectId:targets[3].id,revision:1}]),JobConflict);
  await assert.rejects(()=>jobs.reserve(owner,targets[0].id,0,'',undefined,spec,
    undefined,[{projectId:targets[1].id,revision:2}]),JobConflict);
  const job=await jobs.reserve(owner,targets[0].id,0,'',undefined,spec,undefined,sources);
  assert.deepEqual(job.asset_sources,sources);
  await assert.rejects(()=>jobs.reserve(owner,targets[0].id,0,'',undefined,spec,
    undefined,sources),JobConflict);
  const calls=[];
  const executor={async runPythonScript(dir,who,rev,operation,base,assets){
   calls.push({who,rev,base,assets,operation});
   await writeFile(path.join(dir,'scene.blend'),'BLENDER composed scene');
   await writeFile(path.join(dir,'scene.json'),'{"schema_version":1,"scene":{"objects":[]}}');
  }};
  const workflow=new JobOrchestrator(jobs,files,executor);
  const completed=await workflow.execute(owner,job.id);
  assert.equal(completed.status,'completed');
  assert.equal((await projects.get(owner,targets[0].id)).current_revision,1);
  assert.equal(calls.length,1);
  assert.equal(calls[0].base,undefined);
  assert.deepEqual(calls[0].assets.map(x=>x.offset),sources.map(x=>x.offset));
  assert.deepEqual(calls[0].assets.map(x=>x.path),await Promise.all(sources.map(x=>
   files.verifiedArtifactPath(x.projectId,x.revision,'scene.blend'))));
  for(const p of targets.slice(1,3))
   assert.equal((await projects.get(owner,p.id)).current_revision,1);
});

test('DEV-040 changed source after reservation fails before owner-billed executor',
 {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:3});
  await applyMigrations(pool);
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-compose-reject-'));
  const owner='compose-'+randomUUID(),projects=new ProjectRepository(pool);
  const jobs=new JobRepository(pool),files=new LocalArtifactStore(root);
  const scene=await projects.create(owner,'Target'),asset=await projects.create(owner,'Asset');
  t.after(async()=>{
   try{
    for(const p of [scene,asset]){
     await pool.query('DELETE FROM bw_jobs WHERE project_id=$1',[p.id]);
     await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[p.id]);
     await pool.query('DELETE FROM bw_projects WHERE id=$1',[p.id]);
    }
   }finally{await pool.end();await rm(root,{recursive:true,force:true});}
  });
  const raw=path.join(root,'source.blend');
  await writeFile(raw,'BLENDER source');
  await files.publish({projectId:asset.id,revision:1,expectedPreviousRevision:0,
   artifacts:[{name:'scene.blend',sourcePath:raw}]});
  await projects.addRevision(owner,asset.id,'Source',asset.id+'/00000001');
  const job=await jobs.reserve(owner,scene.id,0,'',undefined,spec,undefined,
   [{projectId:asset.id,revision:1}]);
  await writeFile(await files.verifiedArtifactPath(asset.id,1,'scene.blend'),'tampered');
  let called=false;
  const workflow=new JobOrchestrator(jobs,files,{
   async runPythonScript(){called=true;}
  });
  await assert.rejects(()=>workflow.execute(owner,job.id),/checksum mismatch/i);
  assert.equal(called,false);
  assert.equal((await jobs.get(owner,job.id)).status,'failed');
  assert.equal((await projects.get(owner,scene.id)).current_revision,0);
});
