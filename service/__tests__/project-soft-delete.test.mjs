import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {applyMigrations} from '../dist/db/migrations.js';
import {ProjectRepository} from '../dist/db/projects.js';

test('PostgreSQL soft delete blocks active/recoverable jobs and preserves revisions',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
    const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:4});
    await applyMigrations(pool);
    const projects=new ProjectRepository(pool);
    const owner='portal-owner-'+randomUUID();
    const other='portal-other-'+randomUUID();
    const project=await projects.create(owner,'Original project');
    const id=project.id;
    t.after(async()=>{
      try{
        await pool.query('DELETE FROM bw_jobs WHERE project_id=$1',[id]);
        await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[id]);
        await pool.query('DELETE FROM bw_projects WHERE id=$1',[id]);
      }finally{await pool.end();}
    });
    await projects.addRevision(owner,id,'Immutable revision',id+'/00000001');
    const jobId=randomUUID();
    await pool.query('INSERT INTO bw_jobs '+
      '(id,project_id,owner_key,expected_revision,requested_revision,status,note,edit_spec,operation_spec) '+
      "VALUES($1,$2,$3,1,2,'pending','Test job',NULL,$4::jsonb)",
      [jobId,id,owner,JSON.stringify({kind:'python_script',code:'print(1)'})]);
    assert.equal(await projects.softDelete(other,id),false);
    for(const status of ['pending','running','needs_recovery']){
      await pool.query('UPDATE bw_jobs SET status=$2 WHERE id=$1',[jobId,status]);
      assert.equal(await projects.softDelete(owner,id),false,'should reject '+status);
      assert.ok(await projects.get(owner,id));
    }
    await pool.query("UPDATE bw_jobs SET status='failed' WHERE id=$1",[jobId]);
    assert.equal(await projects.softDelete(owner,id),true);
    assert.equal(await projects.softDelete(owner,id),false);
    assert.equal(await projects.get(owner,id),null);
    assert.deepEqual(await projects.revisions(owner,id),[]);
    assert.equal((await projects.list(owner)).some(p=>p.id===id),false);
    const raw=await pool.query('SELECT deleted_at FROM bw_projects WHERE id=$1',[id]);
    assert.ok(raw.rows[0].deleted_at,'soft delete retains database row');
    const saved=await pool.query('SELECT revision FROM bw_project_revisions WHERE project_id=$1',[id]);
    assert.deepEqual(saved.rows.map(r=>r.revision),[1],'revision metadata retained');
});
