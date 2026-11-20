import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {applyMigrations} from '../dist/db/migrations.js';
import {ProjectRepository} from '../dist/db/projects.js';
import {RenderJobRepository,validateRenderOptions} from '../dist/jobs/render-repository.js';
import {RenderArtifactStore} from '../dist/storage/render-artifacts.js';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';
import {RenderOrchestrator} from '../dist/jobs/render-orchestrator.js';

const settings={engine:'CYCLES',width:256,height:256,samples:8};
const fakePng=()=>Buffer.concat([
 Buffer.from([137,80,78,71,13,10,26,10]),
 Buffer.from([0,0,0,13]),Buffer.from('IHDR'),
 Buffer.from([0,0,1,0,0,0,1,0,8,6,0,0,0]),Buffer.alloc(4),
 Buffer.alloc(36,1)]);
test('rejects unbounded or invented render settings without accessing Modal',()=>{
 for(const input of [
  {engine:'CYCLES',width:4096,height:4096,samples:16},
  {engine:'CYCLES',width:512,height:512,samples:64},
  {engine:'EVIL',width:256,height:256,samples:8},
  {engine:'BLENDER_EEVEE_NEXT',width:0,height:512,samples:8},
 ]){
   assert.throws(()=>validateRenderOptions(input),RangeError);
 }
 assert.deepEqual(validateRenderOptions(settings),settings);
});
test('rendering is owner-scoped, persists PNG, leaves native revision unchanged, and blocks deletion while active',
 {skip:!process.env.TEST_DATABASE_URL},async t=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:5});
 await applyMigrations(pool);
 const base=await mkdtemp(path.join(os.tmpdir(),'bw-test-render-'));
 const owner='render-'+randomUUID(),other='foreign-'+randomUUID();
 const projects=new ProjectRepository(pool),queue=new RenderJobRepository(pool);
 const native=new LocalArtifactStore(base),previews=new RenderArtifactStore(base);
 const project=await projects.create(owner,'Complex hair model');
 t.after(async()=>{
  try{
   await pool.query('DELETE FROM bw_render_jobs WHERE project_id=$1',[project.id]);
   await pool.query('DELETE FROM bw_jobs WHERE project_id=$1',[project.id]);
   await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[project.id]);
   await pool.query('DELETE FROM bw_projects WHERE id=$1',[project.id]);
  }finally{await pool.end();await rm(base,{recursive:true,force:true});}
 });
 const blend=path.join(base,'source.blend');
 await writeFile(blend,'BLENDER original immutable');
 await native.publish({projectId:project.id,revision:1,expectedPreviousRevision:0,
    artifacts:[{name:'scene.blend',sourcePath:blend}]});
 await projects.addRevision(owner,project.id,'Native version',project.id+'/00000001');
 await assert.rejects(()=>queue.reserve(other,project.id,1,settings),RangeError);
 await assert.rejects(()=>queue.reserve(owner,project.id,2,settings),RangeError);
 const job=await queue.reserve(owner,project.id,1,settings);
 await assert.rejects(()=>queue.reserve(owner,project.id,1,settings),RangeError);
 assert.equal(await projects.beginPermanentDelete(owner,project.id),'busy');
 assert.equal((await queue.list(other,project.id)).length,0);
 assert.equal(await queue.get(other,job.id),null);
 await pool.query("UPDATE bw_render_jobs SET status='running' WHERE id=$1",[job.id]);
 const running=await queue.get(owner,job.id);
 let called=0;
 const executor={async run(dir,who,source,opts){
   called++;assert.equal(who,owner);assert.deepEqual(opts,settings);
   assert.equal(await readFile(source,'utf8'),'BLENDER original immutable');
   await writeFile(path.join(dir,'render.png'),fakePng());
 }};
 const workflow=new RenderOrchestrator(queue,native,previews,executor);
 await workflow.executeClaimed(running);
 const finished=await queue.get(owner,job.id);
 assert.equal(finished.status,'completed');
 assert.equal(called,1);
 assert.deepEqual(await readFile(await previews.verifiedPath(project.id,job.id,
   finished.sha256,finished.size_bytes)),fakePng());
 assert.equal((await projects.get(owner,project.id)).current_revision,1);
 assert.deepEqual((await native.inspect(project.id,1)).artifacts.map(a=>a.name),['scene.blend']);
 await assert.rejects(()=>previews.verifiedPath(project.id,job.id,'0'.repeat(64),finished.size_bytes));
 // The derived rendering cannot change the revision, but another render can be queued.
 const second=await queue.reserve(owner,project.id,1,settings);
 assert.equal(second.status,'pending');
});
test('uncertain render commit can be recovered without invoking Modal again',
 {skip:!process.env.TEST_DATABASE_URL},async t=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:4});
 await applyMigrations(pool);
 const root=await mkdtemp(path.join(os.tmpdir(),'bw-render-recovery-'));
 const projects=new ProjectRepository(pool),queue=new RenderJobRepository(pool);
 const native=new LocalArtifactStore(root),previews=new RenderArtifactStore(root);
 const owner='render-recovery-'+randomUUID();
 const project=await projects.create(owner,'Recovery');
 t.after(async()=>{
  try{
   await pool.query('DELETE FROM bw_render_jobs WHERE project_id=$1',[project.id]);
   await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[project.id]);
   await pool.query('DELETE FROM bw_projects WHERE id=$1',[project.id]);
  }finally{await pool.end();await rm(root,{recursive:true,force:true});}
 });
 const blend=path.join(root,'original.blend');
 await writeFile(blend,'BLENDER unchanged');
 await native.publish({projectId:project.id,revision:1,expectedPreviousRevision:0,
   artifacts:[{name:'scene.blend',sourcePath:blend}]});
 await projects.addRevision(owner,project.id,'Original',project.id+'/00000001');
 const job=await queue.reserve(owner,project.id,1,settings);
 await pool.query("UPDATE bw_render_jobs SET status='needs_recovery' WHERE id=$1",[job.id]);
 const file=path.join(root,'finished.png');
 await writeFile(file,fakePng());
 await previews.publish(project.id,job.id,file);
 let calls=0;
 const workflow=new RenderOrchestrator(queue,native,previews,{async run(){calls++;}});
 assert.equal(await workflow.recover(owner,job.id),true);
 assert.equal((await queue.get(owner,job.id)).status,'completed');
 assert.equal(calls,0);
 assert.equal((await projects.get(owner,project.id)).current_revision,1);
});
