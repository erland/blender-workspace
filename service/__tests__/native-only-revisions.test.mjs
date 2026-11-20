import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {applyMigrations} from '../dist/db/migrations.js';
import {ProjectRepository} from '../dist/db/projects.js';
import {JobRepository} from '../dist/jobs/job-repository.js';
import {JobOrchestrator} from '../dist/jobs/orchestrator.js';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';

test('native-only revision completes and can be continued without GLB',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:5});
  await applyMigrations(pool);
  const base=await mkdtemp(path.join(os.tmpdir(),'bw-native-'));
  const owner='native-'+randomUUID();
  const projects=new ProjectRepository(pool),jobs=new JobRepository(pool);
  const project=await projects.create(owner,'Realistic hair curves');
  const store=new LocalArtifactStore(base);
  t.after(async()=>{
    try{
      await pool.query('DELETE FROM bw_jobs WHERE project_id=$1',[project.id]);
      await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[project.id]);
      await pool.query('DELETE FROM bw_projects WHERE id=$1',[project.id]);
    }finally{await pool.end();await rm(base,{recursive:true,force:true});}
  });
  const native=Buffer.from('BLENDERrealistic-native-scene');
  const inputs=[];
  const executor={async runPythonScript(dir,who,revision,spec,input){
    inputs.push(input);
    await writeFile(path.join(dir,'scene.blend'),native);
    await writeFile(path.join(dir,'scene.json'),JSON.stringify({
      schema_version:1,stage:'sandbox_python',scene:{objects:[]},
      preview:{format:'glb',status:'unavailable',reason:'export_failed'},
      artifacts:[{path:'scene.blend',size_bytes:native.length}]
    }));
    // GLB deliberately absent: hair curves must remain in .blend.
  }};
  const workflow=new JobOrchestrator(jobs,store,executor);
  const spec={kind:'python_script',code:'import bpy\nprint(bpy.app.version)'};
  for(let current=0;current<2;current++){
    const job=await jobs.reserve(owner,project.id,current,'Native scene',undefined,spec);
    const done=await workflow.execute(owner,job.id);
    assert.equal(done.status,'completed');
  }
  assert.equal(inputs[0],undefined);
  assert.match(inputs[1],/scene.blend$/);
  assert.deepEqual((await store.inspect(project.id,1)).artifacts.map(a=>a.name),
    ['scene.blend','scene.json']);
  assert.equal((await projects.get(owner,project.id)).current_revision,2);
  assert.deepEqual(await readFile(await store.verifiedArtifactPath(project.id,2,'scene.blend')),native);
  await assert.rejects(()=>store.verifiedArtifactPath(project.id,2,'scene.glb'),/not found/i);
});
