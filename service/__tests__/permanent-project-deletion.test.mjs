import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import pg from 'pg';
import {applyMigrations} from '../dist/db/migrations.js';
import {ProjectRepository} from '../dist/db/projects.js';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';
import {ProjectDeletionService} from '../dist/jobs/project-deletion.js';

const owner='delete-'+randomUUID();
test('permanent delete removes artifacts, jobs, revisions, metadata and is owner-scoped',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
    const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:4});
    await applyMigrations(pool);
    const root=await mkdtemp(path.join(os.tmpdir(),'bw-delete-'));
    const projects=new ProjectRepository(pool);
    const artifacts=new LocalArtifactStore(root);
    const service=new ProjectDeletionService(projects,artifacts);
    const project=await projects.create(owner,'Remove permanently');
    const id=project.id;
    t.after(async()=>{
      try{
        await pool.query('DELETE FROM bw_jobs WHERE project_id=$1',[id]);
        await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[id]);
        await pool.query('DELETE FROM bw_projects WHERE id=$1',[id]);
      }finally{await pool.end();await rm(root,{recursive:true,force:true});}
    });
    const src=path.join(root,'scene.glb');
    await writeFile(src,'test glb contents');
    await artifacts.publish({projectId:id,revision:1,expectedPreviousRevision:0,
      artifacts:[{name:'scene.glb',sourcePath:src}]});
    await projects.addRevision(owner,id,'Test model',id+'/00000001');
    const job=randomUUID();
    await pool.query('INSERT INTO bw_jobs '+
      '(id,project_id,owner_key,expected_revision,requested_revision,status,note,operation_spec) '+
      "VALUES($1,$2,$3,1,2,'pending','Test job',$4::jsonb)",
      [job,id,owner,JSON.stringify({kind:'python_script',code:'print(1)'})]);
    assert.equal(await service.delete('foreign-user',id),'missing');
    assert.ok(await projects.get(owner,id));
    for(const status of ['pending','running','needs_recovery']){
      await pool.query('UPDATE bw_jobs SET status=$2 WHERE id=$1',[job,status]);
      assert.equal(await service.delete(owner,id),'busy');
      assert.equal((await artifacts.listRevisions(id)).length,1);
    }
    await pool.query("UPDATE bw_jobs SET status='completed' WHERE id=$1",[job]);
    assert.equal(await service.delete(owner,id),'deleted');
    assert.equal(await service.delete(owner,id),'missing');
    assert.equal(await projects.get(owner,id),null);
    assert.deepEqual(await artifacts.listRevisions(id),[]);
    const db=await pool.query(
      '(SELECT count(*)::int AS n FROM bw_projects WHERE id=$1) UNION ALL '+
      '(SELECT count(*)::int AS n FROM bw_project_revisions WHERE project_id=$1) UNION ALL '+
      '(SELECT count(*)::int AS n FROM bw_jobs WHERE project_id=$1)',[id]);
    assert.deepEqual(db.rows.map(x=>x.n),[0,0,0]);
    // Other files in the root must never be touched.
    await access(src);
});

test('storage failure retains an explicit tombstone; retry completes cleanup',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
    const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:4});
    await applyMigrations(pool);
    const projects=new ProjectRepository(pool);
    const project=await projects.create(owner,'Interrupted delete');
    const id=project.id;
    t.after(async()=>{
      try{await pool.query('DELETE FROM bw_projects WHERE id=$1',[id]);}
      finally{await pool.end();}
    });
    let failures=1,deletes=0;
    const artifacts={async deleteProject(p){
      assert.equal(p,id);deletes++;
      if(failures--)throw new Error('Transient disk failure');
    }};
    const deletion=new ProjectDeletionService(projects,artifacts);
    await assert.rejects(()=>deletion.delete(owner,id),/Transient disk failure/);
    assert.equal(await projects.get(owner,id),null,'tombstone hides the project');
    const tombstone=await pool.query('SELECT deleted_at,deletion_requested_at FROM bw_projects WHERE id=$1',[id]);
    assert.ok(tombstone.rows[0].deleted_at);
    assert.ok(tombstone.rows[0].deletion_requested_at);
    const result=await deletion.resumePending(100);
    assert.ok(result.processed>=1);
    assert.equal(deletes,2);
    assert.equal((await pool.query('SELECT id FROM bw_projects WHERE id=$1',[id])).rowCount,0);
});

test('legacy soft-deleted project is not automatically purged',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
    const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:4});
    await applyMigrations(pool);
    const projects=new ProjectRepository(pool);
    const project=await projects.create(owner,'Legacy hidden');
    t.after(async()=>{
      try{await pool.query('DELETE FROM bw_projects WHERE id=$1',[project.id]);}
      finally{await pool.end();}
    });
    assert.equal(await projects.softDelete(owner,project.id),true);
    const pending=await projects.pendingPermanentDeletes(100);
    assert.equal(pending.some(p=>p.id===project.id),false);
});
