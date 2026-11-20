import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import pg from 'pg';
import {applyMigrations} from '../dist/db/migrations.js';
import {ProjectRepository} from '../dist/db/projects.js';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';
import {ProjectArchiveService} from '../dist/jobs/project-archive.js';

test('project ZIP roundtrip restores two immutable revisions and is independently editable',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
    const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:4});
    await applyMigrations(pool);
    const root=await mkdtemp(path.join(os.tmpdir(),'bw-archive-'));
    const artifacts=new LocalArtifactStore(root);
    const projects=new ProjectRepository(pool);
    const service=new ProjectArchiveService(projects,artifacts);
    const owner='archive-owner-'+randomUUID();
    const original=await projects.create(owner,'Cube and Cylinder','Archive test');
    const ids=[original.id];
    t.after(async()=>{
      try{
        for(const id of ids){
          await pool.query('DELETE FROM bw_jobs WHERE project_id=$1',[id]);
          await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[id]);
          await pool.query('DELETE FROM bw_projects WHERE id=$1',[id]);
        }
      }finally{await pool.end();await rm(root,{recursive:true,force:true});}
    });
    for(let revision=1;revision<=2;revision++){
      const sources=[];
      for(const name of ['scene.blend','scene.glb','scene.json']){
        const file=path.join(root,name+'-'+revision);
        await writeFile(file,'revision-'+revision+'-data-'+name);
        sources.push({name,sourcePath:file});
      }
      await artifacts.publish({projectId:original.id,revision,
        expectedPreviousRevision:revision-1,artifacts:sources});
      await projects.addRevision(owner,original.id,'Revision '+revision,original.id+'/'+
        String(revision).padStart(8,'0'));
    }
    await assert.rejects(()=>service.export('other-user',original.id),/not found/);
    const {archive,directory}=await service.export(owner,original.id);
    t.after(()=>rm(directory,{recursive:true,force:true}));
    const bytes=await readFile(archive);
    assert.equal(bytes.subarray(0,2).toString(),'PK');
    const importedId=await service.import(owner,bytes);
    ids.push(importedId);
    assert.notEqual(importedId,original.id);
    const originalRevs=await projects.revisions(owner,original.id);
    const restored=await projects.revisions(owner,importedId);
    assert.deepEqual(restored.map(r=>r.note),originalRevs.map(r=>r.note));
    assert.deepEqual(restored.map(r=>r.revision),[1,2]);
    assert.equal((await projects.get(owner,importedId)).current_revision,2);
    for(const revision of [1,2]){
      const src=await artifacts.inspect(original.id,revision,true);
      const dest=await artifacts.inspect(importedId,revision,true);
      assert.deepEqual(dest.artifacts,src.artifacts);
      const originalBytes=await readFile(
        await artifacts.verifiedArtifactPath(original.id,revision,'scene.glb'));
      const restoredBytes=await readFile(
        await artifacts.verifiedArtifactPath(importedId,revision,'scene.glb'));
      assert.deepEqual(restoredBytes,originalBytes);
    }
    const next=path.join(root,'next.glb');
    await writeFile(next,'third revision');
    await artifacts.publish({projectId:importedId,revision:3,expectedPreviousRevision:2,
      artifacts:[{name:'scene.glb',sourcePath:next}]});
    await projects.addRevision(owner,importedId,'Revision 3',importedId+'/00000003');
    assert.equal((await projects.get(owner,importedId)).current_revision,3);
    await artifacts.deleteProject(original.id);
    assert.equal((await artifacts.inspect(importedId,1,true)).revision,1);
  });

test('invalid archives and altered bytes cannot create visible projects',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
    const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:2});
    await applyMigrations(pool);
    const root=await mkdtemp(path.join(os.tmpdir(),'bw-bad-zip-'));
    const projects=new ProjectRepository(pool);
    const service=new ProjectArchiveService(projects,new LocalArtifactStore(root));
    const owner='archive-negative-'+randomUUID();
    t.after(async()=>{await pool.end();await rm(root,{recursive:true,force:true});});
    const before=await projects.list(owner);
    await assert.rejects(()=>service.import(owner,Buffer.from('not a ZIP')));
    await assert.rejects(()=>service.import(owner,Buffer.alloc(0)));
    const after=await projects.list(owner);
    assert.equal(after.length,before.length);
});
