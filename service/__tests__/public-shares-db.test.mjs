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
 await applyMigrations(pool);
 const owner='share-test-'+randomUUID(),foreign='share-test-'+randomUUID();
 const projects=new ProjectRepository(pool);
 const project=await projects.create(owner,'Only this revision','private details');
 const otherProject=await projects.create(foreign,'Other user');
 t.after(async()=>{
   await pool.query('DELETE FROM bw_public_shares WHERE project_id = ANY($1::uuid[])',
     [[project.id,otherProject.id]]);
   await pool.query('DELETE FROM bw_render_jobs WHERE project_id = ANY($1::uuid[])',
     [[project.id,otherProject.id]]);
   await pool.query('DELETE FROM bw_project_revisions WHERE project_id = ANY($1::uuid[])',
     [[project.id,otherProject.id]]);
   await pool.query('DELETE FROM bw_projects WHERE id = ANY($1::uuid[])',
     [[project.id,otherProject.id]]);
   await pool.end();
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
 // A completed render from the precise revision may be explicitly selected.
 const good=randomUUID(),otherRevision=randomUUID(),wrongOwner=randomUUID();
 const renderInsert=`INSERT INTO bw_render_jobs
   (id,project_id,owner_key,source_revision,engine,width,height,samples,
    status,requested_from,sha256,size_bytes,finished_at)
   VALUES($1,$2,$3,$4,'CYCLES',512,512,16,
     'completed','project',$5,100,now())`;
 await pool.query(renderInsert,[good,project.id,owner,1,'a'.repeat(64)]);
 await projects.addRevision(owner,project.id,'Later',project.id+'/00000002');
 await pool.query(renderInsert,[otherRevision,project.id,owner,2,'b'.repeat(64)]);
 await pool.query(renderInsert,[wrongOwner,otherProject.id,foreign,1,'c'.repeat(64)]);
 assert.equal(await repository.setSelectedRenders(foreign,project.id,1,[good]),false);
 assert.equal(await repository.setSelectedRenders(owner,project.id,1,[otherRevision]),false);
 assert.equal(await repository.setSelectedRenders(owner,project.id,1,[wrongOwner]),false);
 assert.equal(await repository.setSelectedRenders(owner,project.id,1,[randomUUID()]),false);
 await assert.rejects(repository.setSelectedRenders(owner,project.id,1,[good,good]),RangeError);
 assert.equal(await repository.setSelectedRenders(owner,project.id,1,[good]),true);
 let publicShare=await repository.resolve(second);
 assert.deepEqual(publicShare.selected_render_ids,[good]);
 assert.equal(publicShare.allow_renders,true);
 assert.equal(publicShare.allow_download,false);
 assert.equal(await repository.setSelectedRenders(owner,project.id,1,[]),true);
 publicShare=await repository.resolve(second);
 assert.deepEqual(publicShare.selected_render_ids,[]);
 assert.equal(publicShare.allow_renders,false);
 assert.equal(await repository.setSelectedRenders(owner,project.id,1,[good]),true);
 // Explicit native download must be disabled initially, owner scoped,
 // independently switchable and immediately revoked without token rotation.
 assert.equal(await repository.setDownloadPermission(foreign,project.id,1,true),false);
 assert.equal(await repository.setDownloadPermission(owner,project.id,2,true),false);
 await assert.rejects(repository.setDownloadPermission(owner,project.id,1,'yes'),RangeError);
 assert.equal(await repository.setDownloadPermission(owner,project.id,1,true),true);
 assert.equal((await repository.resolve(second)).allow_download,true);
 assert.equal(await repository.setDownloadPermission(owner,project.id,1,false),true);
 assert.equal((await repository.resolve(second)).allow_download,false);
 assert.equal(await repository.setDownloadPermission(owner,project.id,1,true),true);
 assert.equal(await repository.revoke(foreign,project.id,1),false);
 assert.ok(await repository.resolve(second));
 assert.equal(await repository.revoke(owner,project.id,1),true);
 assert.equal(await repository.resolve(second),null);
 assert.equal(await repository.setDownloadPermission(owner,project.id,1,true),false);
 assert.equal(await repository.setSelectedRenders(owner,project.id,1,[good]),false);
 assert.ok((await repository.owned(owner,project.id,1)).revoked_at);
});
