import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {applyMigrations} from '../dist/db/migrations.js';
import {ProjectRepository} from '../dist/db/projects.js';
import {JobRepository,JobConflict} from '../dist/jobs/job-repository.js';
import {JobOrchestrator} from '../dist/jobs/orchestrator.js';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';

const code={kind:'python_script',code:'import bpy\nbpy.ops.mesh.primitive_cube_add()'};
const files=['scene.blend','scene.glb','scene.json'];

async function setup(t) {
  const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:8});
  await applyMigrations(pool);
  const base=await mkdtemp(path.join(os.tmpdir(),'bw-python-jobs-'));
  const owner='test-'+randomUUID(),other='test-'+randomUUID();
  const projects=new ProjectRepository(pool),jobs=new JobRepository(pool);
  const project=await projects.create(owner,'Python-first regression');
  t.after(async()=>{
    try {
      await pool.query('DELETE FROM bw_jobs WHERE project_id=$1',[project.id]);
      await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[project.id]);
      await pool.query('DELETE FROM bw_projects WHERE id=$1',[project.id]);
    } finally {await pool.end();await rm(base,{recursive:true,force:true});}
  });
  const store=new LocalArtifactStore(base);
  const calls=[];
  const executor={
    async runPythonScript(dir,who,rev,spec,source){
      calls.push({who,rev,spec,source});
      for(const name of files)
        await writeFile(path.join(dir,name),
          name==='scene.json'?JSON.stringify({schema_version:1,scene:{objects:[]}}):
          'mock-revision-'+rev+'-'+name);
    }
  };
  const orchestrator=new JobOrchestrator(jobs,store,executor);
  async function queue(revision){
    const job=await jobs.reserve(owner,project.id,revision,'Blender Python',undefined,code);
    return orchestrator.execute(owner,job.id);
  }
  return {pool,owner,other,project,projects,jobs,store,calls,executor,orchestrator,queue};
}

test('Python-only create/edit preserves owner, immutable revisions and verified predecessor',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
    const x=await setup(t);
    await assert.rejects(()=>x.jobs.reserve(x.other,x.project.id,0,'foreign',undefined,code),JobConflict);
    assert.equal((await x.queue(0)).status,'completed');
    const source=await x.store.verifiedArtifactPath(x.project.id,1,'scene.blend');
    const first=await readFile(source);
    await assert.rejects(()=>x.jobs.reserve(x.owner,x.project.id,0,'stale',undefined,code),JobConflict);
    assert.equal((await x.queue(1)).status,'completed');
    assert.equal(x.calls.length,2);
    assert.equal(x.calls[0].source,undefined);
    assert.equal(x.calls[1].source,source);
    assert.deepEqual(x.calls.map(c=>c.spec),[code,code]);
    assert.deepEqual(await x.store.listRevisions(x.project.id),[1,2]);
    assert.deepEqual(await readFile(source),first);
    assert.equal((await x.projects.get(x.owner,x.project.id)).current_revision,2);
    assert.deepEqual((await x.store.inspect(x.project.id,2)).artifacts.map(a=>a.name),files);
  });

test('Python publish/DB-finalize split is recoverable without rerunning the worker',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
    const x=await setup(t);
    const finalize=x.jobs.finalize.bind(x.jobs);
    let fail=true;
    x.jobs.finalize=async (...args)=>{
      if(fail){fail=false;throw new Error('DB transient');}
      return finalize(...args);
    };
    const initial=await x.jobs.reserve(x.owner,x.project.id,0,'Python initial',undefined,code);
    await assert.rejects(()=>x.orchestrator.execute(x.owner,initial.id),/DB transient/);
    assert.equal(x.calls.length,1);
    assert.deepEqual(await x.store.listRevisions(x.project.id),[1]);
    assert.equal((await x.projects.get(x.owner,x.project.id)).current_revision,0);
    assert.equal((await x.jobs.get(x.owner,initial.id)).status,'needs_recovery');
    const recovered=await x.orchestrator.recover(x.owner,initial.id);
    assert.equal(recovered.status,'completed');
    assert.equal(x.calls.length,1);
    assert.equal((await x.projects.get(x.owner,x.project.id)).current_revision,1);
  });

test('Tampered Python predecessor blocks the worker and a later revision',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
    const x=await setup(t);
    await x.queue(0);
    const source=await x.store.verifiedArtifactPath(x.project.id,1,'scene.blend');
    await writeFile(source,'tampered predecessor');
    const edit=await x.jobs.reserve(x.owner,x.project.id,1,'Python edit',undefined,code);
    await assert.rejects(()=>x.orchestrator.execute(x.owner,edit.id),/checksum mismatch/i);
    assert.equal(x.calls.length,1);
    assert.equal((await x.jobs.get(x.owner,edit.id)).status,'failed');
    assert.deepEqual(await x.store.listRevisions(x.project.id),[1]);
    assert.equal((await x.projects.get(x.owner,x.project.id)).current_revision,1);
  });
