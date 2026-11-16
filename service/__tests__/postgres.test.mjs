import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { applyMigrations } from '../dist/db/migrations.js';
import { ProjectRepository } from '../dist/db/projects.js';

test('PostgreSQL migration idempotency, revisions and owner isolation',
  {skip:!process.env.TEST_DATABASE_URL}, async t=>{
  const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:10});
  t.after(async()=>pool.end());
  const once=await applyMigrations(pool);
  assert.deepEqual(await applyMigrations(pool),once);
  const owner='test-'+randomUUID(), other='test-'+randomUUID();
  const db=new ProjectRepository(pool);
  const p=await db.create(owner,'Cube Monster','Walking test');
  t.after(async()=>{
    await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[p.id]);
    await pool.query('DELETE FROM bw_projects WHERE id=$1',[p.id]);
  });
  assert.equal(p.current_revision,0);
  assert.equal((await db.get(owner,p.id))?.name,'Cube Monster');
  assert.equal(await db.get(other,p.id),null);
  assert.equal((await db.list(other)).length,0);
  assert.equal(await db.rename(other,p.id,'Wrong'),null);
  assert.equal((await db.rename(owner,p.id,'Blue Monster'))?.name,'Blue Monster');
  const revs=await Promise.all(Array.from({length:8},(_,i)=>db.addRevision(owner,p.id,'step'+i,'artifacts/'+i)));
  assert.deepEqual(revs.map(x=>x.revision).sort((a,b)=>a-b),[1,2,3,4,5,6,7,8]);
  assert.equal((await db.revisions(owner,p.id)).length,8);
  assert.equal((await db.revisions(other,p.id)).length,0);
  assert.equal(await db.addRevision(other,p.id),null);
  assert.equal((await db.get(owner,p.id))?.current_revision,8);
  assert.equal(await db.softDelete(other,p.id),false);
  assert.equal(await db.softDelete(owner,p.id),true);
  assert.equal(await db.get(owner,p.id),null);
  assert.equal(await db.addRevision(owner,p.id),null);
});
test('validation prevents malformed requests',async()=>{
  const db=new ProjectRepository({query(){throw new Error('not reached')}});
  await assert.rejects(()=>db.create(' ','bad'),RangeError);
  await assert.rejects(()=>db.list('ok',101),RangeError);
});
