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

async function fixture(t) {
  const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:8});
  await applyMigrations(pool);
  const base=await mkdtemp(path.join(os.tmpdir(),'bw-jobs-'));
  const owner='test-'+randomUUID(),other='test-'+randomUUID();
  const projects=new ProjectRepository(pool),jobs=new JobRepository(pool);
  const project=await projects.create(owner,'Job test monster');
  t.after(async()=>{
    try {
      await pool.query('DELETE FROM bw_jobs WHERE project_id=$1',[project.id]);
      await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[project.id]);
      await pool.query('DELETE FROM bw_projects WHERE id=$1',[project.id]);
    } finally { await pool.end(); await rm(base,{recursive:true,force:true});}
  });
  const store=new LocalArtifactStore(base);
  const executor={count:0,async createDemo(dir) {
    this.count++;
    for(const name of ['monster_v1.blend','monster_v1.glb','monster_v1.json'])
      await writeFile(path.join(dir,name),Buffer.from('mock-'+name));
  }};
  const workflow=new JobOrchestrator(jobs,store,executor);
  return {pool,base,owner,other,projects,jobs,project,store,executor,workflow};
}

test('runs one job across metadata and immutable volume', {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const x=await fixture(t);
  const finished=await x.workflow.createDemo(x.owner,x.project.id);
  assert.equal(finished.status,'completed');
  assert.equal(x.executor.count,1);
  assert.equal((await x.projects.get(x.owner,x.project.id)).current_revision,1);
  const revision=(await x.projects.revisions(x.owner,x.project.id))[0];
  assert.equal(revision.artifact_prefix,x.project.id+'/00000001');
  assert.deepEqual(await x.store.listRevisions(x.project.id),[1]);
  const manifest=await x.store.inspect(x.project.id,1);
  assert.equal(manifest.artifacts.length,3);
  assert.equal((await x.jobs.get(x.other,finished.id)),null);
  const same=await x.workflow.recover(x.owner,finished.id);
  assert.equal(same.status,'completed');
  assert.equal(x.executor.count,1);
});

test('unique active job, stale revision and ownership isolation', {skip:!process.env.TEST_DATABASE_URL}, async t=>{
  const x=await fixture(t);
  await assert.rejects(()=>x.jobs.reserve(x.other,x.project.id,0),JobConflict);
  const job=await x.jobs.reserve(x.owner,x.project.id,0);
  await assert.rejects(()=>x.jobs.reserve(x.owner,x.project.id,0),JobConflict);
  assert.equal((await x.jobs.get(x.owner,job.id)).status,'pending');
  await assert.rejects(()=>x.workflow.execute(x.other,job.id),JobConflict);
  assert.equal((await x.jobs.get(x.owner,job.id)).status,'pending');
  await x.workflow.execute(x.owner,job.id);
  await assert.rejects(()=>x.jobs.reserve(x.owner,x.project.id,0),JobConflict);
});

test('worker failures remain failed; no revision is created', {skip:!process.env.TEST_DATABASE_URL}, async t=>{
  const x=await fixture(t);
  const runner={async createDemo(){throw new Error('Modal unavailable');}};
  const service=new JobOrchestrator(x.jobs,x.store,runner);
  await assert.rejects(()=>service.createDemo(x.owner,x.project.id),/Modal unavailable/);
  assert.equal((await x.projects.get(x.owner,x.project.id)).current_revision,0);
  assert.deepEqual(await x.store.listRevisions(x.project.id),[]);
  const row=await x.pool.query('SELECT status FROM bw_jobs WHERE project_id=$1',[x.project.id]);
  assert.equal(row.rows[0].status,'failed');
  assert.equal((await x.workflow.createDemo(x.owner,x.project.id)).status,'completed');
});

test('DB failure after artifact publish is recoverable without reexecuting worker',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const x=await fixture(t);
  const real=x.jobs.finalize.bind(x.jobs);
  let once=true;
  x.jobs.finalize=async(...args)=>{
    if(once){once=false;throw new Error('transient database failure');}
    return real(...args);
  };
  await assert.rejects(()=>x.workflow.createDemo(x.owner,x.project.id),/transient database failure/);
  assert.equal(x.executor.count,1);
  assert.deepEqual(await x.store.listRevisions(x.project.id),[1]);
  assert.equal((await x.projects.get(x.owner,x.project.id)).current_revision,0);
  const row=await x.pool.query('SELECT * FROM bw_jobs WHERE project_id=$1',[x.project.id]);
  assert.equal(row.rows[0].status,'needs_recovery');
  const recovered=await x.workflow.recover(x.owner,row.rows[0].id);
  assert.equal(recovered.status,'completed');
  assert.equal((await x.projects.get(x.owner,x.project.id)).current_revision,1);
  assert.equal(x.executor.count,1);
});

test('tampering blocks recovery and preserves journal', {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const x=await fixture(t);
  x.jobs.finalize=async()=>{throw new Error('commit failed');};
  await assert.rejects(()=>x.workflow.createDemo(x.owner,x.project.id),/commit failed/);
  const row=await x.pool.query('SELECT id FROM bw_jobs WHERE project_id=$1',[x.project.id]);
  const p=await x.store.verifiedArtifactPath(x.project.id,1,'monster_v1.glb');
  await writeFile(p,'tampered');
  await assert.rejects(()=>x.workflow.recover(x.owner,row.rows[0].id),/checksum mismatch/);
  assert.equal((await x.projects.get(x.owner,x.project.id)).current_revision,0);
});

test('rejects initial-demo replay on existing revision', {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const x=await fixture(t);
  await x.workflow.createDemo(x.owner,x.project.id);
  await assert.rejects(()=>x.jobs.reserve(x.owner,x.project.id,0),JobConflict);
  const revision2=await x.jobs.reserve(x.owner,x.project.id,1);
  await assert.rejects(()=>x.workflow.execute(x.owner,revision2.id),/Only initial demo/);
  assert.equal((await x.jobs.get(x.owner,revision2.id)).status,'failed');
  assert.deepEqual(await x.store.listRevisions(x.project.id),[1]);
});
