import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {GlbPreviewRepository} from '../dist/jobs/glb-preview-repository.js';
import {GlbPreviewArtifactStore} from '../dist/storage/glb-preview-artifacts.js';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';
import {ProjectRepository} from '../dist/db/projects.js';
import {applyMigrations} from '../dist/db/migrations.js';

test('preview refresh requires an existing owner-scoped native revision; does not increment it',
 {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:3});
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-preview001-'));
  const owner='preview-owner-'+randomUUID();
  const projects=new ProjectRepository(pool);
  const originals=new LocalArtifactStore(root);
  const previews=new GlbPreviewRepository(pool);
  await applyMigrations(pool);
  const p=await projects.create(owner,'Preview source');
  t.after(async()=>{
    try{
      await pool.query('DELETE FROM bw_glb_preview_jobs WHERE project_id=$1',[p.id]);
      await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[p.id]);
      await pool.query('DELETE FROM bw_projects WHERE id=$1',[p.id]);
    }finally{await pool.end();await rm(root,{recursive:true,force:true});}
  });
  await assert.rejects(()=>previews.reserve(owner,p.id,1));
  const blend=path.join(root,'source.blend');
  await writeFile(blend,'BLENDER-v302native-original');
  await originals.publish({projectId:p.id,revision:1,expectedPreviousRevision:0,
    artifacts:[{name:'scene.blend',sourcePath:blend}]});
  await projects.addRevision(owner,p.id,'Original native model',p.id+'/00000001');
  await assert.rejects(()=>previews.reserve('other-owner',p.id,1));
  const queued=await previews.reserve(owner,p.id,1);
  assert.equal(queued.status,'pending');
  await assert.rejects(()=>previews.reserve(owner,p.id,1));
  assert.equal((await projects.get(owner,p.id)).current_revision,1);
  const claimed=await previews.claimNext();
  // Connected Modal account isn't provisioned in this DB regression, so a
  // pending job correctly cannot launch. Do not touch source bytes.
  assert.equal(claimed?.id,undefined);
  assert.equal((await readFile(blend)).toString(),'BLENDER-v302native-original');
  assert.equal((await projects.get(owner,p.id)).current_revision,1);
});

test('derived GLB artifact is immutable and checksum-protected',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'bw-glb-store-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new GlbPreviewArtifactStore(root);
 const project=randomUUID(),job=randomUUID();
 const file=path.join(root,'source.glb');
 const raw=Buffer.alloc(24);
 raw.write('glTF',0,'ascii');raw.writeUInt32LE(2,4);raw.writeUInt32LE(24,8);
 await writeFile(file,raw);
 const saved=await store.publish(project,job,file);
 assert.equal(await store.verifiedPath(project,job,saved.sha256,saved.sizeBytes),
   path.join(root,project,'glb-previews',job+'.glb'));
 await assert.rejects(()=>store.publish(project,job,file));
 const derived=path.join(root,project,'glb-previews',job+'.glb');
 await writeFile(derived,Buffer.alloc(24));
 await assert.rejects(()=>store.verifiedPath(project,job,saved.sha256,saved.sizeBytes));
});
