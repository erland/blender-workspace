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
import {parseSceneEdit} from '../dist/jobs/scene-edit.js';
import {parseSceneOperation} from '../dist/jobs/scene-operation.js';

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
  // The fixture intentionally only supports initial creation; revision 2 now requires
  // a dedicated executor rather than being categorically unsupported.
  await assert.rejects(()=>x.workflow.execute(x.owner,revision2.id),/Revision executor is not configured/);
  assert.equal((await x.jobs.get(x.owner,revision2.id)).status,'failed');
  assert.deepEqual(await x.store.listRevisions(x.project.id),[1]);
});

test('revision 2 reads verified original .blend and publishes immutable v2 without changing v1',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const x=await fixture(t);
  const v1=await x.workflow.createDemo(x.owner,x.project.id);
  assert.equal(v1.status,'completed');
  const original=await x.store.verifiedArtifactPath(x.project.id,1,'monster_v1.blend');
  const before=(await import('node:fs/promises')).readFile;
  const originalBytes=await before(original);
  let received=null;
  const revisionExecutor={
    async createDemo(){throw Error('Should not recreate')},
    async reviseDemo(dir,owner,input){
      received={owner,input};
      for(const filename of ['monster_v2.blend','monster_v2.glb','monster_v2.json'])
        await writeFile(path.join(dir,filename),'recolored-'+filename);
    }
  };
  const workflow=new JobOrchestrator(x.jobs,x.store,revisionExecutor);
  const reserved=await x.jobs.reserve(x.owner,x.project.id,1,'Blue body');
  const finished=await workflow.execute(x.owner,reserved.id);
  assert.equal(finished.status,'completed');
  assert.deepEqual(received,{owner:x.owner,input:original});
  assert.equal((await x.projects.get(x.owner,x.project.id)).current_revision,2);
  assert.deepEqual(await x.store.listRevisions(x.project.id),[1,2]);
  assert.deepEqual(await before(original),originalBytes);
  assert.deepEqual((await x.store.inspect(x.project.id,2,true)).artifacts.map(a=>a.name),
    ['monster_v2.blend','monster_v2.glb','monster_v2.json']);
  assert.equal((await x.jobs.get(x.other,reserved.id)),null);
  const unsupported=await x.jobs.reserve(x.owner,x.project.id,2);
  await assert.rejects(()=>workflow.execute(x.owner,unsupported.id),/structured edit is required/);
  assert.equal((await x.jobs.get(x.owner,unsupported.id)).status,'failed');
});

test('corrupt prior scene blocks revision before Modal and publishes nothing',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const x=await fixture(t);
  await x.workflow.createDemo(x.owner,x.project.id);
  const original=await x.store.verifiedArtifactPath(x.project.id,1,'monster_v1.blend');
  await writeFile(original,'tampered input');
  let runs=0;
  const workflow=new JobOrchestrator(x.jobs,x.store,{
    async createDemo(){throw Error('Unexpected creation')},
    async reviseDemo(){runs++;}
  });
  const reserved=await x.jobs.reserve(x.owner,x.project.id,1);
  await assert.rejects(()=>workflow.execute(x.owner,reserved.id),/checksum mismatch/i);
  assert.equal(runs,0);
  assert.equal((await x.jobs.get(x.owner,reserved.id)).status,'failed');
  assert.equal((await x.projects.get(x.owner,x.project.id)).current_revision,1);
  assert.deepEqual(await x.store.listRevisions(x.project.id),[1]);
});

test('validated structured edit can create immutable revision 3 from v2, and command survives DB reload',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const x=await fixture(t);
  await x.workflow.createDemo(x.owner,x.project.id);
  const v2executor={async createDemo(){throw Error('unexpected')},async reviseDemo(dir){
    for(const name of ['monster_v2.blend','monster_v2.glb','monster_v2.json'])
      await writeFile(path.join(dir,name),'version-2-'+name);
  }};
  const workflow2=new JobOrchestrator(x.jobs,x.store,v2executor);
  const blue=await x.jobs.reserve(x.owner,x.project.id,1,'Blue');
  await workflow2.execute(x.owner,blue.id);
  const original=await x.store.verifiedArtifactPath(x.project.id,2,'monster_v2.blend');
  const initial=await (await import('node:fs/promises')).readFile(original);
  const edit=parseSceneEdit({target:'Body',color:[0.8,0.3,0.2],scale:[1,1.5,1],
    location:[0,0,1]});
  const reserved=await x.jobs.reserve(x.owner,x.project.id,2,'Structured edit',edit);
  const fromDb=await x.jobs.get(x.owner,reserved.id);
  assert.deepEqual(fromDb.edit_spec,edit);
  let call;
  const workflow3=new JobOrchestrator(x.jobs,x.store,{
    async createDemo(){throw Error('unexpected')},
    async editScene(dir,owner,input,revision,received){
      call={owner,input,revision,received};
      for(const name of ['monster_v3.blend','monster_v3.glb','monster_v3.json'])
        await writeFile(path.join(dir,name),'version-3-'+name);
    }
  });
  const completed=await workflow3.execute(x.owner,reserved.id);
  assert.equal(completed.status,'completed');
  assert.deepEqual(call,{owner:x.owner,input:original,revision:3,received:edit});
  assert.equal((await x.projects.get(x.owner,x.project.id)).current_revision,3);
  assert.deepEqual(await x.store.listRevisions(x.project.id),[1,2,3]);
  assert.deepEqual(await (await import('node:fs/promises')).readFile(original),initial);
  assert.equal((await x.store.inspect(x.project.id,3)).artifacts.length,3);
  await assert.rejects(()=>x.jobs.reserve(x.other,x.project.id,3,'Cross-tenant',edit),JobConflict);
  await assert.rejects(()=>x.jobs.reserve(x.owner,x.project.id,2,'Stale',edit),JobConflict);
});
test('strict edit rejects code injection, unknown target and invalid numeric transforms',()=>{
  for(const edit of [{target:'Body',python:'__import__("os")'},
    {target:'Leg',color:[1,0,0]},
    {target:'Body',scale:[0,1,1]},
    {target:'Body',location:[11,0,0]},
    {target:'Body',color:[NaN,0,0]},
    {target:'Body'},
    {target:'Body',color:[1,2,3]}]){
    assert.throws(()=>parseSceneEdit(edit));
  }
  assert.deepEqual(parseSceneEdit({target:'Body',color:[0,0.4,1]}),
    {target:'Body',color:[0,0.4,1]});
});

test('generic scene revisions support arbitrary 3D assets, immutable file names and owner isolation',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const x=await fixture(t);
  const called=[];
  const runner={
    async createDemo(){throw Error('Legacy demo must not run')},
    async runSceneOperation(dir,owner,revision,operation,input){
      called.push({owner,revision,operation,input});
      for(const filename of ['scene.blend','scene.glb','scene.json'])
        await writeFile(path.join(dir,filename),
          filename==='scene.json'?JSON.stringify({schema_version:1,scene:{objects:[
            {name:operation.name,type:'MESH',materials:[],bones:[]}]}}):
          'generic-'+revision+'-'+filename);
    }
  };
  const flow=new JobOrchestrator(x.jobs,x.store,runner);
  const create=parseSceneOperation({kind:'add_primitive',name:'Architectural Column',primitive:'cylinder',
    location:[0,1,2],color:[0.4,0.5,0.6]});
  const reserved=await x.jobs.reserve(x.owner,x.project.id,0,'Start arbitrary scene',undefined,create);
  assert.deepEqual((await x.jobs.get(x.owner,reserved.id)).operation_spec,create);
  assert.equal((await flow.execute(x.owner,reserved.id)).status,'completed');
  assert.equal(called[0].input,undefined);
  const original=await x.store.verifiedArtifactPath(x.project.id,1,'scene.blend');
  const originalBytes=await (await import('node:fs/promises')).readFile(original);
  const edit=parseSceneOperation({kind:'set_transform',name:'Architectural Column',
    location:[4,0,1],scale:[1,1,2]});
  const next=await x.jobs.reserve(x.owner,x.project.id,1,'Adjust column',undefined,edit);
  assert.equal((await flow.execute(x.owner,next.id)).status,'completed');
  assert.deepEqual(called[1],{owner:x.owner,revision:2,operation:edit,input:original});
  assert.equal((await x.projects.get(x.owner,x.project.id)).current_revision,2);
  assert.deepEqual(await x.store.listRevisions(x.project.id),[1,2]);
  assert.deepEqual(await (await import('node:fs/promises')).readFile(original),originalBytes);
  assert.deepEqual((await x.store.inspect(x.project.id,2)).artifacts.map(a=>a.name),
    ['scene.blend','scene.glb','scene.json']);
  await assert.rejects(()=>x.jobs.reserve(x.other,x.project.id,2,'Attack',undefined,edit),JobConflict);
  await assert.rejects(()=>x.jobs.reserve(x.owner,x.project.id,1,'Stale',undefined,edit),JobConflict);
});
test('generic operation schema rejects scripts and unsafe payloads',()=>{
  for(const x of [
    {kind:'exec_python',name:'A',source:'import os'},
    {kind:'add_primitive',name:'../x',primitive:'cube'},
    {kind:'add_primitive',name:'X',primitive:'mesh_from_url'},
    {kind:'set_transform',name:'X'},
    {kind:'set_transform',name:'X',location:[NaN,0,0]},
    {kind:'set_color',name:'X',color:[1,2,0]},
    {kind:'delete_object',name:'X',shell:'rm -rf /'}]){
    assert.throws(()=>parseSceneOperation(x));
  }
});

test('bounded scene batches persist atomically and publish a single immutable revision', 
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const x=await fixture(t);
  const edits=parseSceneOperation({kind:'batch',operations:[
    {kind:'add_primitive',name:'Tabletop',primitive:'cube',scale:[3,2,0.1]},
    {kind:'add_primitive',name:'Leg A',primitive:'cylinder',location:[-1,-0.6,-1]},
    {kind:'set_color',name:'Leg A',color:[0.4,0.3,0.2]}]});
  let received;
  const workflow=new JobOrchestrator(x.jobs,x.store,{
    async createDemo(){throw Error('Legacy demo should not run')},
    async runSceneOperation(dir,owner,revision,operation,input){
      received={owner,revision,operation,input};
      for(const filename of ['scene.blend','scene.glb','scene.json'])
        await writeFile(path.join(dir,filename),filename);
    }
  });
  const job=await x.jobs.reserve(x.owner,x.project.id,0,'Table components',undefined,edits);
  assert.deepEqual((await x.jobs.get(x.owner,job.id)).operation_spec,edits);
  assert.equal((await workflow.execute(x.owner,job.id)).status,'completed');
  assert.deepEqual(received,{owner:x.owner,revision:1,operation:edits,input:undefined});
  assert.deepEqual(await x.store.listRevisions(x.project.id),[1]);
  assert.equal((await x.projects.get(x.owner,x.project.id)).current_revision,1);
  await assert.rejects(()=>x.jobs.reserve(x.other,x.project.id,1,'Forbidden',undefined,edits),JobConflict);
});
test('batches reject nested, oversized or unsafe operation payloads',()=>{
  const add={kind:'add_primitive',name:'Cube',primitive:'cube'};
  assert.equal(parseSceneOperation({kind:'batch',operations:[add]}).kind,'batch');
  for(const value of [
    {kind:'batch',operations:[]},
    {kind:'batch',operations:Array.from({length:21},()=>add)},
    {kind:'batch',operations:[{kind:'batch',operations:[add]}]},
    {kind:'batch',operations:[{...add,python:'import os'}]},
    {kind:'batch',operations:[{kind:'delete_object',name:'x',path:'/etc'}]}
  ])assert.throws(()=>parseSceneOperation(value));
});

test('duplicate operation accepts bounded batches and rejects unsafe references',()=>{
  const op={kind:'duplicate_object',source:'Leg',name:'Leg 2',
    location:[2,0,0],scale:[1,1,1]};
  assert.deepEqual(parseSceneOperation(op),op);
  assert.equal(parseSceneOperation({kind:'batch',operations:[
    {kind:'add_primitive',name:'Leg',primitive:'cylinder'},op]}).kind,'batch');
  for(const bad of [
    {...op,name:'Leg'},
    {...op,source:'../Leg'},
    {...op,script:'import os'},
    {...op,scale:[0,1,1]},
    {...op,location:[Infinity,0,0]},
    {kind:'duplicate_object',name:'New'}
  ])assert.throws(()=>parseSceneOperation(bad));
});
