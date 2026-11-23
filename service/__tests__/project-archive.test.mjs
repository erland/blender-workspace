import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import pg from 'pg';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
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


test('strict ZIP reader rejects traversal paths, duplicate names and symlinks',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-zip-attack-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const attacks=['traversal','duplicate','symlink'];
  for(const kind of attacks){
    const file=path.join(root,kind+'.zip');
    const script=[
      'import sys,zipfile,stat,json',
      'target=sys.argv[1]; kind=sys.argv[2]',
      'with zipfile.ZipFile(target,"w") as z:',
      ' z.writestr("project.json", json.dumps({"formatVersion":1,"project":{"originalId":"11111111-1111-4111-8111-111111111111","name":"Valid project","description":"","currentRevision":0},"revisions":[]}))',
      ' if kind=="traversal": z.writestr("../escaped.txt", "attack")',
      ' if kind=="duplicate": z.writestr("project.json", "{}")',
      ' if kind=="symlink":',
      '  i=zipfile.ZipInfo("revisions/00000001/scene.glb")',
      '  i.create_system=3; i.external_attr=(stat.S_IFLNK|0o777)<<16',
      '  z.writestr(i,"/outside")'
    ].join('\n');
    await exec('python3',['-c',script,file,kind]);
    const dest=path.join(root,'out-'+kind);
    await assert.rejects(()=>exec('python3',['archive_tool.py','import',file,dest,dest],
      {cwd:process.cwd()}),kind);
  }
});


test('empty projects can be exported and reimported without a Modal job',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
    const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:2});
    await applyMigrations(pool);
    const root=await mkdtemp(path.join(os.tmpdir(),'bw-empty-archive-'));
    const projects=new ProjectRepository(pool);
    const service=new ProjectArchiveService(projects,new LocalArtifactStore(root));
    const owner='archive-empty-'+randomUUID();
    const original=await projects.create(owner,'Empty model');
    const ids=[original.id];
    t.after(async()=>{
      try{
        for(const id of ids)await pool.query('DELETE FROM bw_projects WHERE id=$1',[id]);
      }finally{await pool.end();await rm(root,{recursive:true,force:true});}
    });
    const {archive,directory}=await service.export(owner,original.id);
    t.after(()=>rm(directory,{recursive:true,force:true}));
    const imported=await service.import(owner,await readFile(archive));
    ids.push(imported);
    assert.equal((await projects.get(owner,imported)).current_revision,0);
    assert.deepEqual(await projects.revisions(owner,imported),[]);
});

test('DEV-062 project ZIP stores shared textures once and restores every revision manifest',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
    const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:4});
    await applyMigrations(pool);
    const root=await mkdtemp(path.join(os.tmpdir(),'bw-shared-resource-archive-'));
    const artifacts=new LocalArtifactStore(root);
    const projects=new ProjectRepository(pool);
    const service=new ProjectArchiveService(projects,artifacts);
    const owner='archive-resource-'+randomUUID();
    const original=await projects.create(owner,'Textured model','Resource archive roundtrip');
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
    const source=path.join(root,'shared-texture.png');
    await writeFile(source,'identical image bytes '.repeat(25));
    const blob=await artifacts.storeResource(source);
    const resource={name:'resources/'+blob.sha256+'.png',...blob};
    for(let revision=1;revision<=2;revision++){
      const blend=path.join(root,'source-'+revision+'.blend');
      await writeFile(blend,'BLENDER saved revision '+revision);
      await artifacts.publish({projectId:original.id,revision,
        expectedPreviousRevision:revision-1,
        artifacts:[{name:'scene.blend',sourcePath:blend}],resources:[resource]});
      await projects.addRevision(owner,original.id,'Textured revision '+revision,
        original.id+'/'+String(revision).padStart(8,'0'));
    }
    const {archive,directory}=await service.export(owner,original.id);
    t.after(()=>rm(directory,{recursive:true,force:true}));
    const inspect=await exec('python3',['-c',[
      'import json,zipfile,sys',
      'with zipfile.ZipFile(sys.argv[1]) as z:',
      ' data=json.loads(z.read("project.json"))',
      ' print(json.dumps({"names":z.namelist(),"data":data}))'
    ].join('\n'),archive]);
    const parsed=JSON.parse(inspect.stdout);
    assert.equal(parsed.data.formatVersion,2);
    assert.equal(parsed.data.resources.length,1);
    assert.deepEqual(parsed.data.revisions.map(r=>r.resources),[[resource],[resource]]);
    assert.equal(parsed.names.filter(n=>n==='resources/'+blob.sha256).length,1);
    assert.equal(parsed.names.filter(n=>n.startsWith('resources/')).length,1);
    assert.ok(!JSON.stringify(parsed.data).includes(root),
      'private absolute source paths must never be exported');
    const backup=await readFile(archive);
    const imported=await service.import(owner,backup);
    ids.push(imported);
    assert.notEqual(imported,original.id);
    assert.equal((await projects.get(owner,imported)).current_revision,2);
    for(const revision of [1,2]){
      const restored=await artifacts.inspect(imported,revision,true);
      assert.deepEqual(restored.resources,[resource]);
      const [resolved]=await artifacts.verifiedRevisionResources(imported,revision);
      assert.equal((await readFile(resolved.path)).toString(),(await readFile(source)).toString());
    }
    await artifacts.deleteProject(original.id);
    assert.deepEqual((await artifacts.inspect(imported,1,true)).resources,[resource]);
    const after=await service.export(owner,imported);
    t.after(()=>rm(after.directory,{recursive:true,force:true}));
    assert.equal((await readFile(after.archive)).subarray(0,2).toString(),'PK');
  });

test('DEV-062 missing or altered resource entry is rejected before project import',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
    const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:2});
    await applyMigrations(pool);
    const root=await mkdtemp(path.join(os.tmpdir(),'bw-resource-archive-neg-'));
    const artifacts=new LocalArtifactStore(root);
    const projects=new ProjectRepository(pool);
    const service=new ProjectArchiveService(projects,artifacts);
    const owner='archive-negative-resources-'+randomUUID();
    t.after(async()=>{await pool.end();await rm(root,{recursive:true,force:true});});
    // ZIP has an apparently correct v2 manifest but no referenced image.
    const file=path.join(root,'invalid.zip');
    const script=[
      'import json,zipfile,hashlib,sys',
      'data=b"BLENDER-v400"',
      'sha=hashlib.sha256(b"missing resource").hexdigest()',
      'item={"sha256":sha,"sizeBytes":len(b"missing resource")}',
      'meta={"formatVersion":2,"project":{"originalId":"11111111-1111-4111-8111-111111111111","name":"Invalid resources","description":"","currentRevision":1},',
      ' "resources":[item],"revisions":[{"revision":1,"note":"test","createdAt":"2026-01-01T00:00:00Z",',
      ' "artifacts":[{"name":"scene.blend","sha256":hashlib.sha256(data).hexdigest(),"sizeBytes":len(data)}],',
      ' "resources":[{"name":"resources/"+sha+".png",**item}]}]}',
      'with zipfile.ZipFile(sys.argv[1],"w") as z:',
      ' z.writestr("project.json",json.dumps(meta))',
      ' z.writestr("revisions/00000001/scene.blend",data)'
    ].join('\n');
    await exec('python3',['-c',script,file]);
    await assert.rejects(()=>service.import(owner,await readFile(file)));
    assert.deepEqual(await projects.list(owner),[]);
  });
