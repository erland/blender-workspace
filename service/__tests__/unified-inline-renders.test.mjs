import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {applyMigrations} from '../dist/db/migrations.js';
import {ProjectRepository} from '../dist/db/projects.js';
import {JobRepository} from '../dist/jobs/job-repository.js';
import {JobOrchestrator} from '../dist/jobs/orchestrator.js';
import {RenderJobRepository} from '../dist/jobs/render-repository.js';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';
import {RenderArtifactStore} from '../dist/storage/render-artifacts.js';

const png=Buffer.concat([
 Buffer.from([137,80,78,71,13,10,26,10]),
 Buffer.from([0,0,0,13]),Buffer.from('IHDR'),
 Buffer.from([0,0,2,0,0,0,2,0,8,6,0,0,0]),Buffer.alloc(4),
 Buffer.alloc(48,1)
]);
const spec={kind:'python_script',code:'import bpy\nbpy.ops.mesh.primitive_cube_add()',inlineRender:true};

async function setup(t){
 const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:6});
 await applyMigrations(pool);
 const root=await mkdtemp(path.join(os.tmpdir(),'bw-unified-renders-'));
 const owner='dev046-'+randomUUID();
 const projects=new ProjectRepository(pool),jobs=new JobRepository(pool);
 const renders=new RenderJobRepository(pool);
 const files=new LocalArtifactStore(root);
 const imageFiles=new RenderArtifactStore(root);
 const project=await projects.create(owner,'Unified render');
 t.after(async()=>{
   try{
     await pool.query('DELETE FROM bw_render_jobs WHERE project_id=$1',[project.id]);
     await pool.query('DELETE FROM bw_jobs WHERE project_id=$1',[project.id]);
     await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[project.id]);
     await pool.query('DELETE FROM bw_projects WHERE id=$1',[project.id]);
   }finally{await pool.end();await rm(root,{recursive:true,force:true});}
 });
 const executor={async runPythonScript(folder){
   await writeFile(path.join(folder,'scene.blend'),Buffer.from('BLENDER model'));
   await writeFile(path.join(folder,'scene.json'),JSON.stringify({
     schema_version:1,stage:'sandbox_python',scene:{objects:[{name:'Cube',type:'MESH'}]},
     inlineRender:{format:'png',status:'available',engine:'CYCLES',width:512,height:512,samples:16}
   }));
   await writeFile(path.join(folder,'scene.png'),png);
 }};
 return {pool,owner,projects,jobs,renders,files,imageFiles,project,executor};
}

test('DEV-046 inline image becomes an ordinary completed, owner-scoped render without another job',
 {skip:!process.env.TEST_DATABASE_URL},async t=>{
 const x=await setup(t);
 const workflow=new JobOrchestrator(x.jobs,x.files,x.executor,undefined,x.renders,x.imageFiles);
 const job=await x.jobs.reserve(x.owner,x.project.id,0,'Render cube',undefined,spec);
 const result=await workflow.execute(x.owner,job.id);
 assert.equal(result.status,'completed');
 const render=await x.renders.get(x.owner,job.id);
 assert.equal(render.id,job.id);
 assert.equal(render.status,'completed');
 assert.equal(render.source_revision,1);
 assert.equal(render.engine,'CYCLES');
 assert.deepEqual([render.width,render.height,render.samples],[512,512,16]);
 assert.deepEqual(await readFile(await x.imageFiles.verifiedPath(
   x.project.id,job.id,render.sha256,render.size_bytes)),png);
 assert.equal((await x.renders.list(x.owner,x.project.id,1)).length,1);
 assert.equal((await x.renders.recentCompletedByProjects(x.owner,[x.project.id])).length,1);
 assert.equal((await x.renders.list('other',x.project.id)).length,0);
 assert.deepEqual(await x.files.listRevisions(x.project.id),[1]);
 assert.equal(await workflow.registerSavedInlineRender(result),true);
 assert.equal((await x.renders.list(x.owner,x.project.id)).length,1);
 assert.equal((await x.jobs.listUnregisteredInlineRenders()).some(j=>j.id===job.id),false);
});

test('DEV-046 failed derived render publication never changes successful native revision; recovery reuses PNG',
 {skip:!process.env.TEST_DATABASE_URL},async t=>{
 const x=await setup(t);
 const brokenFiles={inspectUncommitted:async()=>null,publish:async()=>{throw new Error('Synthetic disk issue');}};
 const workflow=new JobOrchestrator(x.jobs,x.files,x.executor,undefined,x.renders,brokenFiles);
 const job=await x.jobs.reserve(x.owner,x.project.id,0,'Recover PNG',undefined,spec);
 const result=await workflow.execute(x.owner,job.id);
 assert.equal(result.status,'completed');
 assert.equal(await x.renders.get(x.owner,job.id),null);
 assert.equal((await x.jobs.listUnregisteredInlineRenders()).some(j=>j.id===job.id),true);
 const repaired=new JobOrchestrator(x.jobs,x.files,x.executor,undefined,x.renders,x.imageFiles);
 assert.equal(await repaired.registerSavedInlineRender(result),true);
 assert.equal((await x.renders.get(x.owner,job.id)).status,'completed');
 assert.equal(await repaired.registerSavedInlineRender(result),true);
 assert.equal((await x.renders.list(x.owner,x.project.id)).length,1);
 assert.equal((await x.projects.get(x.owner,x.project.id)).current_revision,1);
});
