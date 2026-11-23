import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {applyMigrations} from '../dist/db/migrations.js';
import {ProjectRepository} from '../dist/db/projects.js';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';
import {ProjectCloneService} from '../dist/jobs/project-clone.js';
import {JobRepository} from '../dist/jobs/job-repository.js';
import {JobOrchestrator} from '../dist/jobs/orchestrator.js';

async function fixture(t){
 const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:4});
 await applyMigrations(pool);
 const root=await mkdtemp(path.join(os.tmpdir(),'bw-clone-'));
 const projects=new ProjectRepository(pool),artifacts=new LocalArtifactStore(root);
 const clones=new ProjectCloneService(projects,artifacts);
 const owner='clone-'+randomUUID(),other='other-'+randomUUID();
 const src=await projects.create(owner,'Original dinosaur');
 const ids=[src.id];
 t.after(async()=>{
  try{
   for(const id of ids){
    await pool.query('DELETE FROM bw_jobs WHERE project_id=$1',[id]);
    await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[id]);
    await pool.query('DELETE FROM bw_projects WHERE id=$1',[id]);
   }
  }finally{await pool.end();await rm(root,{recursive:true,force:true});}
 });
 for(let n=1;n<=3;n++){
  const sources=[];
  for(const name of ['scene.blend','scene.glb','scene.json']){
   const file=path.join(root,name+'-'+n);
   await writeFile(file,'source revision '+n+' '+name);
   sources.push({name,sourcePath:file});
  }
  await artifacts.publish({projectId:src.id,revision:n,
    expectedPreviousRevision:n-1,artifacts:sources});
  await projects.addRevision(owner,src.id,'Revision '+n,src.id+'/'+String(n).padStart(8,'0'));
 }
 return {pool,root,projects,artifacts,clones,owner,other,src,ids};
}

test('DEV-039 cloned project is standalone revision 1 with verified original bytes and provenance',
 {skip:!process.env.TEST_DATABASE_URL},async t=>{
 const x=await fixture(t);
 const old=await readFile(await x.artifacts.verifiedArtifactPath(x.src.id,1,'scene.blend'));
 await assert.rejects(()=>x.clones.clone(x.other,x.src.id,1,'Unauthorized'),/not found/);
 await assert.rejects(()=>x.clones.clone(x.owner,x.src.id,4,'Future'),/not found/);
 const copy=await x.clones.clone(x.owner,x.src.id,1,'Alternative Rex','Branch concept');
 x.ids.push(copy.id);
 assert.equal(copy.current_revision,1);
 assert.equal(copy.name,'Alternative Rex');
 assert.equal(copy.description,'Branch concept');
 assert.equal((await x.projects.get(x.owner,x.src.id)).current_revision,3);
 assert.equal(await x.projects.get(x.other,copy.id),null);
 const lineage=(await x.projects.revisions(x.owner,copy.id))[0];
 assert.equal(lineage.source_project_id,x.src.id);
 assert.equal(lineage.source_project_revision,1);
 const a=await x.artifacts.inspect(x.src.id,1,true);
 const b=await x.artifacts.inspect(copy.id,1,true);
 assert.deepEqual(b.artifacts,a.artifacts);
 assert.deepEqual(await readFile(await x.artifacts.verifiedArtifactPath(copy.id,1,'scene.blend')),old);
 assert.notDeepEqual(await readFile(await x.artifacts.verifiedArtifactPath(x.src.id,3,'scene.blend')),old);
 // New project is independently editable using the existing immutable revision job flow.
 const jobs=new JobRepository(x.pool);
 const editor={async runPythonScript(dir,_owner,rev,_script,source){
  assert.equal(rev,2);
  assert.equal(source,await x.artifacts.verifiedArtifactPath(copy.id,1,'scene.blend'));
  await writeFile(path.join(dir,'scene.blend'),'changed derived model');
  await writeFile(path.join(dir,'scene.json'),'{"scene":{"objects":[]}}');
 }};
 const job=await jobs.reserve(x.owner,copy.id,1,'Edit cloned model',undefined,
  {kind:'python_script',code:'pass'});
 await new JobOrchestrator(jobs,x.artifacts,editor).execute(x.owner,job.id);
 assert.equal((await x.projects.get(x.owner,copy.id)).current_revision,2);
 assert.deepEqual(await readFile(await x.artifacts.verifiedArtifactPath(x.src.id,1,'scene.blend')),old);
 // Original may be permanently deleted without affecting independent copies.
 await x.artifacts.deleteProject(x.src.id);
 await x.pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[x.src.id]);
 await x.pool.query('DELETE FROM bw_projects WHERE id=$1',[x.src.id]);
 x.ids.shift();
 assert.deepEqual(await readFile(await x.artifacts.verifiedArtifactPath(copy.id,1,'scene.blend')),old);
});

test('DEV-039 checksum failure and preview-only source cannot create visible clone',
 {skip:!process.env.TEST_DATABASE_URL},async t=>{
 const x=await fixture(t);
 const f=await x.artifacts.verifiedArtifactPath(x.src.id,2,'scene.blend');
 await writeFile(f,'tampered');
 const initial=(await x.projects.list(x.owner)).length;
 await assert.rejects(()=>x.clones.clone(x.owner,x.src.id,2,'Corrupt'),/checksum/i);
 assert.equal((await x.projects.list(x.owner)).length,initial);
 const legacy=await x.projects.create(x.owner,'GLB only');
 x.ids.push(legacy.id);
 const glb=path.join(x.root,'only.glb');
 await writeFile(glb,'glTF placeholder');
 await x.artifacts.publish({projectId:legacy.id,revision:1,expectedPreviousRevision:0,
   artifacts:[{name:'scene.glb',sourcePath:glb}]});
 await x.projects.addRevision(x.owner,legacy.id,'GLB only',legacy.id+'/00000001');
 await assert.rejects(()=>x.clones.clone(x.owner,legacy.id,1,'Invalid'),/native Blender/);
 assert.equal((await x.projects.list(x.owner)).length,initial+1);
});

test('DEV-039 failed publication cleans up hidden project, leaving source unchanged',
 {skip:!process.env.TEST_DATABASE_URL},async t=>{
 const x=await fixture(t);
 let attempted=false;
 const broken={...x.artifacts,
   inspect:x.artifacts.inspect.bind(x.artifacts),
   verifiedArtifactPath:x.artifacts.verifiedArtifactPath.bind(x.artifacts),
   verifiedRevisionResources:x.artifacts.verifiedRevisionResources.bind(x.artifacts),
   async publish(){attempted=true;throw new Error('Injected copy failure');},
   deleteProject:x.artifacts.deleteProject.bind(x.artifacts)
 };
 const service=new ProjectCloneService(x.projects,broken);
 const before=(await x.projects.list(x.owner)).length;
 await assert.rejects(()=>service.clone(x.owner,x.src.id,1,'Should rollback'),/Injected copy failure/);
 assert.ok(attempted);
 assert.equal((await x.projects.list(x.owner)).length,before);
 assert.deepEqual(await x.artifacts.listRevisions(x.src.id),[1,2,3]);
});

test('DEV-063 cloned textured revision preserves immutable external resources, including after source deletion',
 {skip:!process.env.TEST_DATABASE_URL},async t=>{
 const x=await fixture(t);
 const texture=path.join(x.root,'clone-original-texture.png');
 const bytes=Buffer.from('PNG independently reused texture '+randomUUID());
 await writeFile(texture,bytes);
 const stored=await x.artifacts.storeResource(texture);
 const resource={name:'resources/'+stored.sha256+'.png',...stored};
 const scene=path.join(x.root,'external-model.blend');
 await writeFile(scene,'BLENDER native references //'+resource.name);
 const textured=await x.projects.create(x.owner,'Textured source');
 x.ids.push(textured.id);
 await x.artifacts.publish({projectId:textured.id,revision:1,
   expectedPreviousRevision:0,artifacts:[{name:'scene.blend',sourcePath:scene}],
   resources:[resource]});
 await x.projects.addRevision(x.owner,textured.id,'Original with texture',
   textured.id+'/00000001');
 const copy=await x.clones.clone(x.owner,textured.id,1,'Independent textured copy');
 x.ids.push(copy.id);
 const original=await x.artifacts.inspect(textured.id,1,true);
 const cloned=await x.artifacts.inspect(copy.id,1,true);
 assert.deepEqual(cloned.resources,original.resources);
 assert.deepEqual(cloned.artifacts,original.artifacts);
 const [resolved]=await x.artifacts.verifiedRevisionResources(copy.id,1);
 assert.deepEqual(await readFile(resolved.path),bytes);
 // Deleting source must not invalidate clone, since the shared blob has
 // independent revision references and is not deleted with project files.
 await x.artifacts.deleteProject(textured.id);
 assert.deepEqual((await x.artifacts.inspect(copy.id,1,true)).resources,[resource]);
 const copiedBlend=await x.artifacts.verifiedArtifactPath(copy.id,1,'scene.blend');
 assert.match((await readFile(copiedBlend)).toString(),/resources\\//);
});
test('DEV-063 cloning fails closed if a referenced texture has been corrupted',
 {skip:!process.env.TEST_DATABASE_URL},async t=>{
 const x=await fixture(t);
 const image=path.join(x.root,'corruptable-texture.png');
 await writeFile(image,'texture original bytes');
 const stored=await x.artifacts.storeResource(image);
 const resource={name:'resources/'+stored.sha256+'.png',...stored};
 const scene=path.join(x.root,'corruptable.blend');
 await writeFile(scene,'BLENDER model');
 const project=await x.projects.create(x.owner,'Resource corrupt source');
 x.ids.push(project.id);
 await x.artifacts.publish({projectId:project.id,revision:1,
  expectedPreviousRevision:0,artifacts:[{name:'scene.blend',sourcePath:scene}],
  resources:[resource]});
 await x.projects.addRevision(x.owner,project.id,'First',project.id+'/00000001');
 const [bound]=await x.artifacts.verifiedRevisionResources(project.id,1);
 await writeFile(bound.path,'changed texture bytes');
 const before=(await x.projects.list(x.owner)).length;
 await assert.rejects(()=>x.clones.clone(x.owner,project.id,1,'Must not clone'),
  /checksum|mismatch|corrupt|unsafe/i);
 assert.equal((await x.projects.list(x.owner)).length,before);
});
