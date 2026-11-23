import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {applyMigrations} from '../dist/db/migrations.js';
import {PublicShareRepository} from '../dist/jobs/public-shares.js';
import {ProjectRepository} from '../dist/db/projects.js';

test('DEV-055 DB hashes share token, scopes revision, rotates and immediately revokes',
 {skip:!process.env.TEST_DATABASE_URL},async t=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:4});
 t.after(()=>pool.end());
 await applyMigrations(pool);
 const owner='share-test-'+randomUUID(),foreign='share-test-'+randomUUID();
 const projects=new ProjectRepository(pool);
 const project=await projects.create(owner,'Only this revision','private details');
 const otherProject=await projects.create(foreign,'Other user');
 t.after(async()=>{
   await pool.query('DELETE FROM bw_public_shares WHERE project_id = ANY($1::uuid[])',
     [[project.id,otherProject.id]]);
   await pool.query('DELETE FROM bw_project_revisions WHERE project_id = ANY($1::uuid[])',
     [[project.id,otherProject.id]]);
   await pool.query('DELETE FROM bw_projects WHERE id = ANY($1::uuid[])',
     [[project.id,otherProject.id]]);
 });
 await projects.addRevision(owner,project.id,'Saved',project.id+'/00000001');
 await projects.addRevision(foreign,otherProject.id,'Saved',otherProject.id+'/00000001');
 const repository=new PublicShareRepository(pool);
 await assert.rejects(repository.create(foreign,project.id,1));
 await assert.rejects(repository.create(owner,project.id,2));
 const {token:first}=await repository.create(owner,project.id,1);
 assert.match(first,/^[A-Za-z0-9_-]{43}$/);
 const db=await pool.query('SELECT token_sha256,allow_renders,allow_download,selected_render_ids FROM bw_public_shares WHERE project_id=$1',[project.id]);
 assert.equal(db.rows[0].token_sha256,createHash('sha256').update(first).digest('hex'));
 assert.equal(db.rows[0].allow_renders,false);
 assert.equal(db.rows[0].allow_download,false);
 assert.deepEqual(db.rows[0].selected_render_ids,[]);
 assert.ok(await repository.resolve(first));
 assert.equal(await repository.resolve('bad'),null);
 assert.equal(await repository.owned(foreign,project.id,1),null);
 const {token:second}=await repository.create(owner,project.id,1);
 assert.notEqual(first,second);
 assert.equal(await repository.resolve(first),null);
 assert.ok(await repository.resolve(second));
 assert.equal(await repository.revoke(foreign,project.id,1),false);
 assert.ok(await repository.resolve(second));
 assert.equal(await repository.revoke(owner,project.id,1),true);
 assert.equal(await repository.resolve(second),null);
 assert.ok((await repository.owned(owner,project.id,1)).revoked_at);
});
