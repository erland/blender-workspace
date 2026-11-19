import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {applyMigrations} from '../dist/db/migrations.js';
import {ProjectRepository} from '../dist/db/projects.js';
import {JobRepository,JobConflict} from '../dist/jobs/job-repository.js';
import {JobOrchestrator} from '../dist/jobs/orchestrator.js';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';
import {parsePythonScript} from '../dist/jobs/python-script.js';

const spec=parsePythonScript({kind:'python_script',code:'import bpy\nbpy.ops.mesh.primitive_cube_add()'});

async function fixture(t,run){
  const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:8});
  await applyMigrations(pool);
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-jobs-python-'));
  const owner='test-'+randomUUID(),other='test-'+randomUUID();
  const projects=new ProjectRepository(pool),jobs=new JobRepository(pool);
  const project=await projects.create(owner,'Arbitrary Python 3D model');
  t.after(async()=>{
    try{
      await pool.query('DELETE FROM bw_jobs WHERE project_id=$1',[project.id]);
      await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[project.id]);
      await pool.query('DELETE FROM bw_projects WHERE id=$1',[project.id]);
    }finally{await pool.end();await rm(root,{recursive:true,force:true});}
  });
  const store=new LocalArtifactStore(root);
  let executions=0;
  const executor={async runPythonScript(dir,who,revision,source,input){
    executions++;
    if(run)return run({dir,who,revision,source,input});
    for(const filename of ['scene.blend','scene.glb','scene.json'])
      await writeFile(path.join(dir,filename),'mock-'+revision+'-'+filename);
  }};
  const workflow=new JobOrchestrator(jobs,store,executor);
  return {pool,owner,other,projects,jobs,project,store,workflow,
    getExecutions:()=>executions};
}

test('Python jobs enforce owner, one active job, and revision locking',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const x=await fixture(t);
  await assert.rejects(()=>x.jobs.reserve(x.other,x.project.id,0,'Other',undefined,spec),JobConflict);
  const job=await x.jobs.reserve(x.owner,x.project.id,0,'Start scene',undefined,spec);
  assert.deepEqual((await x.jobs.get(x.owner,job.id)).operation_spec,spec);
  await assert.rejects(()=>x.jobs.reserve(x.owner,x.project.id,0,'Duplicate',undefined,spec),JobConflict);
  await assert.rejects(()=>x.workflow.execute(x.other,job.id),JobConflict);
  assert.equal((await x.jobs.get(x.owner,job.id)).status,'pending');
  const completed=await x.workflow.execute(x.owner,job.id);
  assert.equal(completed.status,'completed');
  assert.equal((await x.projects.get(x.owner,x.project.id)).current_revision,1);
  assert.equal(x.getExecutions(),1);
  assert.equal((await x.workflow.recover(x.owner,job.id)).status,'completed');
  assert.equal(x.getExecutions(),1);
  await assert.rejects(()=>x.jobs.reserve(x.owner,x.project.id,0,'Stale',undefined,spec),JobConflict);
});

test('Python worker failure leaves no revision and can be retried as a new job',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
  let fails=true;
  const x=await fixture(t,async({dir,revision})=>{
    if(fails){fails=false;throw Error('Blender unavailable');}
    for(const ext of ['blend','glb','json'])
      await writeFile(path.join(dir,'scene.'+ext),'mock-'+revision+'-'+ext);
  });
  const first=await x.jobs.reserve(x.owner,x.project.id,0,'Attempt 1',undefined,spec);
  await assert.rejects(()=>x.workflow.execute(x.owner,first.id),/Blender unavailable/);
  assert.equal((await x.jobs.get(x.owner,first.id)).status,'failed');
  assert.equal((await x.projects.get(x.owner,x.project.id)).current_revision,0);
  assert.deepEqual(await x.store.listRevisions(x.project.id),[]);
  const retry=await x.jobs.reserve(x.owner,x.project.id,0,'Attempt 2',undefined,spec);
  assert.equal((await x.workflow.execute(x.owner,retry.id)).status,'completed');
  assert.equal(x.getExecutions(),2);
});

test('Corrupted published Python artifacts cannot be recovered after DB failure',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const x=await fixture(t);
  x.jobs.finalize=async()=>{throw Error('Database finalize failed');};
  const job=await x.jobs.reserve(x.owner,x.project.id,0,'Publish',undefined,spec);
  await assert.rejects(()=>x.workflow.execute(x.owner,job.id),/Database finalize failed/);
  assert.equal((await x.jobs.get(x.owner,job.id)).status,'needs_recovery');
  const glb=await x.store.verifiedArtifactPath(x.project.id,1,'scene.glb');
  await writeFile(glb,'tampered GLB');
  await assert.rejects(()=>x.workflow.recover(x.owner,job.id),/checksum mismatch/i);
  assert.equal((await x.projects.get(x.owner,x.project.id)).current_revision,0);
  assert.equal(x.getExecutions(),1);
});

test('Python scripts reject injection fields, NUL, oversized and non-UTF8-bound content',()=>{
  for(const value of [
    {kind:'python_script',code:''},
    {kind:'python_script',code:'   '},
    {kind:'python_script',code:'print(1)\0'},
    {kind:'python_script',code:'x'.repeat(16385)},
    {kind:'python_script',code:'å'.repeat(9000)},
    {kind:'python_script',code:'print(1)',path:'/etc/passwd'},
    {kind:'batch',operations:[spec]}
  ])assert.throws(()=>parsePythonScript(value));
  assert.deepEqual(parsePythonScript(spec),spec);
});

test('retired demo and typed jobs fail closed instead of invoking Blender',async()=>{
  const oldJobs=[
    {operation_spec:null,edit_spec:null},
    {operation_spec:{kind:'add_primitive',name:'Old',primitive:'cube'},edit_spec:null},
    {operation_spec:null,edit_spec:{target:'Body',color:[0,0,1]}}
  ];
  for(const payload of oldJobs){
    const calls=[];
    const job={id:'old-job',project_id:'old-project',owner_key:'legacy-owner',
      expected_revision:0,requested_revision:1,status:'running',...payload};
    const jobs={
      async markFailed(owner,id){calls.push(['failed',owner,id]);},
      async markRecoverable(){throw Error('Must not recover retired work');},
      async finalize(){throw Error('Must not finalize retired work');}
    };
    const artifacts={
      async verifiedArtifactPath(){throw Error('Must not read legacy scene');},
      async publish(){throw Error('Must not publish legacy scene');}
    };
    const executor={async runPythonScript(){throw Error('Must not execute retired work');}};
    const workflow=new JobOrchestrator(jobs,artifacts,executor);
    await assert.rejects(()=>workflow.executeClaimed(job));
    assert.deepEqual(calls,[['failed','legacy-owner','old-job']]);
  }
});
