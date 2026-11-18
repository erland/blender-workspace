import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/app.js';
import {loadConfig} from '../dist/config.js';
import {applyMigrations} from '../dist/db/migrations.js';
import {ProjectRepository} from '../dist/db/projects.js';
import {JobRepository} from '../dist/jobs/job-repository.js';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const token='m'.repeat(48);
async function start(t,owner,pool,artifacts) {
  const config=loadConfig({MCP_ACCESS_TOKEN:token,PUBLIC_ORIGIN:'http://127.0.0.1:3000',MCP_OWNER_KEY:owner});
  const app=createApp(config,{ownerKey:owner,projects:new ProjectRepository(pool),jobs:new JobRepository(pool),...(artifacts?{artifacts}:{})});
  await app.listen({port:0,host:'127.0.0.1'});t.after(()=>app.close());
  let id=1;
  return async (method,params={},authorized=true) => {
    const response=await fetch('http://127.0.0.1:'+app.server.address().port+'/mcp',{
      method:'POST',
      headers:{'content-type':'application/json','accept':'application/json, text/event-stream',
        ...(authorized?{authorization:'Bearer '+token}:{})},
      body:JSON.stringify({jsonrpc:'2.0',id:id++,method,params})
    });
    const body=await response.text();
    if(!authorized)return {status:response.status,body};
    assert.equal(response.status,200,body);
    // HTTP transport may return JSON or one SSE data frame.
    const json=body.startsWith('data:')?JSON.parse(body.slice(5).trim())
      :body.includes('\ndata:')?JSON.parse(body.split('\n').find(x=>x.startsWith('data:')).slice(5))
      :JSON.parse(body);
    return json.result;
  };
}
function output(reply) {
  assert.ok(reply?.content?.length,JSON.stringify(reply));
  return JSON.parse(reply.content[0].text);
}
test('authenticated MCP project tools, owner isolation and queued job', {skip:!process.env.TEST_DATABASE_URL}, async t => {
  const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:6});
  await applyMigrations(pool);
  const owner='mcp-test-'+randomUUID(),other='mcp-other-'+randomUUID();
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-mcp-scene-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const artifacts=new LocalArtifactStore(root);
  const call=await start(t,owner,pool,artifacts),otherCall=await start(t,other,pool,artifacts);
  const toolList=await call('tools/list');
  const names=toolList.tools.map(x=>x.name);
  for (const name of ['workspace_create_project','workspace_list_projects','workspace_get_project',
    'workspace_rename_project','workspace_list_revisions','workspace_queue_demo',
    'workspace_queue_recolor_blue','workspace_queue_scene_edit',
    'workspace_queue_scene_operation',
    'workspace_inspect_scene','workspace_get_job'])
    assert.ok(names.includes(name),name);
  const created=output(await call('tools/call',{name:'workspace_create_project',arguments:{name:'Cube monster'}}));
  const id=created.project.id;
  let newSceneId;
  t.after(async()=>{
    try {
      if(newSceneId){
        await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[newSceneId]);
        await pool.query('DELETE FROM bw_projects WHERE id=$1',[newSceneId]);
      }
      await pool.query('DELETE FROM bw_jobs WHERE project_id=$1',[id]);
      await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[id]);
      await pool.query('DELETE FROM bw_projects WHERE id=$1',[id]);
    } finally { await pool.end(); }
  });
  assert.equal(created.project.name,'Cube monster');
  assert.equal(output(await call('tools/call',{name:'workspace_list_projects',arguments:{}})).projects.some(p=>p.id===id),true);
  assert.equal(output(await otherCall('tools/call',{name:'workspace_list_projects',arguments:{}})).projects.some(p=>p.id===id),false);
  assert.equal((await otherCall('tools/call',{name:'workspace_get_project',arguments:{projectId:id}})).isError,true);
  assert.equal((await otherCall('tools/call',{name:'workspace_queue_demo',arguments:{projectId:id}})).isError,true);
  const renamed=output(await call('tools/call',{name:'workspace_rename_project',arguments:{projectId:id,name:'New name'}}));
  assert.equal(renamed.project.name,'New name');
  assert.equal((await call('tools/call',{name:'workspace_queue_recolor_blue',
    arguments:{projectId:id}})).isError,true);
  assert.equal((await call('tools/call',{name:'workspace_queue_scene_edit',arguments:{
    projectId:id,expectedRevision:1,edit:{target:'Body',color:[0.1,0.2,0.3]}
  }})).isError,true);
  assert.equal((await call('tools/call',{name:'workspace_inspect_scene',
    arguments:{projectId:id,revision:1}})).isError,true);
  // Scene metadata can be entirely unrelated to the cube-monster fixture.
  const newScene=output(await call('tools/call',{name:'workspace_create_project',
    arguments:{name:'Modern house'}})).project;
  newSceneId=newScene.id;
  const reportPath=path.join(root,'house_report.json');
  const blendPath=path.join(root,'house.blend');
  await writeFile(reportPath,JSON.stringify({schema_version:1,scene:{objects:[
    {name:'Hallway / Door',type:'MESH',materials:['Oak'],bones:[]},
    {name:'Main Camera',type:'CAMERA',materials:[],bones:[]}
  ]}}));
  await writeFile(blendPath,'saved 3D architecture scene');
  await artifacts.publish({projectId:newScene.id,revision:1,expectedPreviousRevision:0,
    artifacts:[{name:'model.blend',sourcePath:blendPath},
      {name:'scene_report.json',sourcePath:reportPath}]});
  await new ProjectRepository(pool).addRevision(owner,newScene.id,'Architectural concept',
    newScene.id+'/00000001');
  const inspected=output(await call('tools/call',{name:'workspace_inspect_scene',
    arguments:{projectId:newScene.id,revision:1}}));
  assert.deepEqual(inspected.scene.objects.map(x=>x.name),['Hallway / Door','Main Camera']);
  assert.equal(inspected.scene.objects[1].type,'CAMERA');
  assert.equal((await otherCall('tools/call',{name:'workspace_inspect_scene',
    arguments:{projectId:newScene.id,revision:1}})).isError,true);
  await writeFile(await artifacts.verifiedArtifactPath(newScene.id,1,'scene_report.json'),
    '{"schema_version":1,"scene":{"objects":[]}}');
  assert.equal((await call('tools/call',{name:'workspace_inspect_scene',
    arguments:{projectId:newScene.id,revision:1}})).isError,true);
  const operation={kind:'add_primitive',name:'Building Block',primitive:'cube'};
  assert.equal((await otherCall('tools/call',{name:'workspace_queue_scene_operation',
    arguments:{projectId:id,expectedRevision:0,operation}})).isError,true);
  assert.equal((await call('tools/call',{name:'workspace_queue_scene_operation',
    arguments:{projectId:id,expectedRevision:0,
      operation:{kind:'set_color',name:'X',color:[1,0,0]}}})).isError,true);
  const queued=output(await call('tools/call',{name:'workspace_queue_demo',arguments:{projectId:id}}));
  assert.equal(queued.job.status,'pending');
  assert.match(queued.message,/automatic worker dispatch/);
  assert.equal((await call('tools/call',{name:'workspace_queue_demo',arguments:{projectId:id}})).isError,true);
  assert.equal(output(await call('tools/call',{name:'workspace_get_job',arguments:{jobId:queued.job.id}})).job.status,'pending');
  assert.equal((await otherCall('tools/call',{name:'workspace_get_job',arguments:{jobId:queued.job.id}})).isError,true);
  assert.deepEqual(output(await call('tools/call',{name:'workspace_list_revisions',arguments:{projectId:id}})).revisions,[]);
  assert.equal((await call('tools/call',{name:'workspace_get_project',arguments:{projectId:'../../x'}})).isError,true);
  const denied=await call('tools/list',{},false);
  assert.equal(denied.status,401);
});
