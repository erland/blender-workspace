import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {applyMigrations} from '../dist/db/migrations.js';
import {ProjectRepository} from '../dist/db/projects.js';
import {JobRepository} from '../dist/jobs/job-repository.js';
import {JobOrchestrator} from '../dist/jobs/orchestrator.js';
import {JobDispatcher} from '../dist/jobs/dispatcher.js';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';
import {ModalAccountManager} from '../dist/modal/modal-accounts.js';

async function fixture(t) {
  const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:8});
  await applyMigrations(pool);
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-dispatch-'));
  const ownerA='dispatcher-'+randomUUID(),ownerB='dispatcher-'+randomUUID();
  const accounts=new ModalAccountManager(pool,randomBytes(32),{async verify(){}});
  const projects=new ProjectRepository(pool),jobs=new JobRepository(pool);
  const pA=await projects.create(ownerA,'Dispatcher A');
  const pB=await projects.create(ownerB,'Dispatcher B');
  t.after(async()=>{
    try {
      await pool.query('DELETE FROM bw_jobs WHERE project_id=ANY($1)',[[pA.id,pB.id]]);
      await pool.query('DELETE FROM bw_project_revisions WHERE project_id=ANY($1)',[[pA.id,pB.id]]);
      await pool.query('DELETE FROM bw_projects WHERE id=ANY($1)',[[pA.id,pB.id]]);
      await pool.query('DELETE FROM bw_modal_accounts WHERE owner_key=ANY($1)',[[ownerA,ownerB]]);
    } finally {await pool.end();await rm(root,{recursive:true,force:true});}
  });
  const owners=[];
  const executor={async runPythonScript(dir,owner,revision,spec,inputBlend){
    owners.push(owner);
    assert.equal(spec.kind,'python_script');
    assert.equal(inputBlend,undefined);
    assert.equal(revision,1);
    await new Promise(resolve=>setTimeout(resolve,15));
    for(const name of ['scene.blend','scene.glb','scene.json'])
      await writeFile(path.join(dir,name),name==='scene.json'?
        JSON.stringify({resourceFiles:[]}):'fake-'+name);
  }};
  const workflow=new JobOrchestrator(jobs,new LocalArtifactStore(root),executor);
  const dispatcher=new JobDispatcher(jobs,workflow,{pollMs:250,graceMinutes:30});
  return {pool,accounts,projects,jobs,ownerA,ownerB,pA,pB,owners,workflow,dispatcher,root};
}
test('dispatcher atomically claims jobs across replicas and keeps tenant ownership',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const x=await fixture(t);
  const first=await x.jobs.reserve(x.ownerA,x.pA.id,0,'Python scene',undefined,{kind:'python_script',code:'import bpy\nprint(1)'});
  const second=await x.jobs.reserve(x.ownerB,x.pB.id,0,'Python scene',undefined,{kind:'python_script',code:'import bpy\nprint(1)'});
  assert.deepEqual(await x.dispatcher.dispatchOnce(),{state:'idle'},
    'no personal Modal token => never run with shared service credentials');
  assert.equal((await x.jobs.get(x.ownerA,first.id)).status,'pending');
  await x.accounts.saveAndTest(x.ownerA,'ak-a','as-a');
  await x.accounts.saveAndTest(x.ownerB,'ak-b','as-b');
  const worker2=new JobDispatcher(x.jobs,x.workflow,{pollMs:250});
  const [a,b]=await Promise.all([x.dispatcher.dispatchOnce(),worker2.dispatchOnce()]);
  assert.deepEqual(new Set([a.jobId,b.jobId]),new Set([first.id,second.id]));
  assert.equal(a.state,'completed');assert.equal(b.state,'completed');
  assert.deepEqual(new Set(x.owners),new Set([x.ownerA,x.ownerB]));
  assert.equal((await x.jobs.get(x.ownerA,first.id)).status,'completed');
  assert.equal((await x.jobs.get(x.ownerB,second.id)).status,'completed');
  assert.equal((await x.projects.get(x.ownerA,x.pA.id)).current_revision,1);
  assert.equal((await x.projects.get(x.ownerB,x.pB.id)).current_revision,1);
  assert.deepEqual(await x.dispatcher.dispatchOnce(),{state:'idle'});
  assert.equal(x.owners.length,2,'jobs must not run twice');
});

test('failed worker is marked failed and is not automatically retried',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const x=await fixture(t);
  await x.accounts.saveAndTest(x.ownerA,'ak-a','as-a');
  const first=await x.jobs.reserve(x.ownerA,x.pA.id,0,'Python scene',undefined,{kind:'python_script',code:'import bpy\nprint(1)'});
  const failing=new JobDispatcher(x.jobs,{async executeClaimed(job){
    await x.jobs.markFailed(job.owner_key,job.id,'Test worker failure');
    throw new Error('Modal secret that must not leak');
  }},{pollMs:250});
  assert.deepEqual(await failing.dispatchOnce(),{state:'failed',jobId:first.id});
  assert.equal((await x.jobs.get(x.ownerA,first.id)).status,'failed');
  assert.deepEqual(await failing.dispatchOnce(),{state:'idle'});
  assert.equal(x.owners.length,0);
});

test('stale running jobs are quarantined for explicit recovery, never re-executed',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const x=await fixture(t);
  await x.accounts.saveAndTest(x.ownerA,'ak-a','as-a');
  const j=await x.jobs.reserve(x.ownerA,x.pA.id,0,'Python scene',undefined,{kind:'python_script',code:'import bpy\nprint(1)'});
  const claimed=await x.jobs.claimNext();
  assert.equal(claimed.id,j.id);
  await x.pool.query(`UPDATE bw_jobs SET updated_at=now()-interval '50 minutes', worker_heartbeat_at=now()-interval '50 minutes' WHERE id=$1`,[j.id]);
  assert.equal(await x.jobs.quarantineStaleRunning(30),1);
  assert.equal((await x.jobs.get(x.ownerA,j.id)).status,'needs_recovery');
  assert.deepEqual(await x.dispatcher.dispatchOnce(),{state:'idle'});
  assert.equal(x.owners.length,0,'unknown Modal billing state must not be restarted');
  await assert.rejects(()=>x.workflow.recover(x.ownerA,j.id),/not found|ENOENT|missing/i);
  assert.equal((await x.jobs.get(x.ownerA,j.id)).status,'needs_recovery');
  await assert.rejects(()=>x.jobs.reserve(x.ownerA,x.pA.id,0,'Python scene',undefined,{kind:'python_script',code:'import bpy\nprint(1)'}),/Another job is active/);
  await assert.rejects(()=>x.jobs.quarantineStaleRunning(1),RangeError);
});

test('dispatcher stops cleanly during idle polling',async()=>{
  let scanned=0;
  const fakeJobs={async claimNext(){return null;},
    async quarantineStaleRunning(){scanned++;return 0;}};
  const d=new JobDispatcher(fakeJobs,{async executeClaimed(){throw Error('should not run');}},
    {pollMs:250});
  const stop=new AbortController();
  setTimeout(()=>stop.abort(),50);
  await d.run(stop.signal);
  assert.ok(scanned>=1);
  assert.throws(()=>new JobDispatcher(fakeJobs,{}, {pollMs:10}),RangeError);
});

test('DEV-049: independent worker heartbeat prevents a healthy long-running job from quarantine',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const x=await fixture(t);
  await x.accounts.saveAndTest(x.ownerA,'ak-a','as-a');
  const j=await x.jobs.reserve(x.ownerA,x.pA.id,0,'Alive',undefined,
    {kind:'python_script',code:'import bpy'});
  await x.jobs.claimNext();
  await x.pool.query(`UPDATE bw_jobs SET updated_at=now()-interval '60 minutes',
    worker_heartbeat_at=now()-interval '60 minutes' WHERE id=$1`,[j.id]);
  assert.equal(await x.jobs.heartbeat(x.ownerA,j.id,'blender_execution',true),true);
  const active=await x.jobs.get(x.ownerA,j.id);
  assert.equal(active.progress_phase,'blender_execution');
  assert.ok(active.worker_heartbeat_at);
  assert.ok(active.blender_heartbeat_at);
  assert.equal(await x.jobs.quarantineStaleRunning(30),0);
  assert.equal((await x.jobs.get(x.ownerA,j.id)).status,'running');
  await x.jobs.markFailed(x.ownerA,j.id,'failure');
  assert.equal(await x.jobs.heartbeat(x.ownerA,j.id,'modal_start',true),false,
    'late heartbeat must never revive a terminal job');
  assert.equal((await x.jobs.get(x.ownerA,j.id)).status,'failed');
  await assert.rejects(()=>x.jobs.heartbeat(x.ownerA,j.id,'untrusted',true),RangeError);
});

test('DEV-049: watchdog quarantines expired deadline even with recent heartbeat',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const x=await fixture(t);
  await x.accounts.saveAndTest(x.ownerA,'ak-a','as-a');
  const j=await x.jobs.reserve(x.ownerA,x.pA.id,0,'Deadline',undefined,
    {kind:'python_script',code:'import bpy'});
  await x.jobs.claimNext();
  await x.pool.query(`UPDATE bw_jobs SET deadline_at=now()-interval '1 second',
    worker_heartbeat_at=now() WHERE id=$1`,[j.id]);
  assert.equal(await x.jobs.quarantineStaleRunning(30),1);
  assert.equal((await x.jobs.get(x.ownerA,j.id)).status,'needs_recovery');
  assert.equal(await x.jobs.heartbeat(x.ownerA,j.id,'blender_execution',true),false);
});
