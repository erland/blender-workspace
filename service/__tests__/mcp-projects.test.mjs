import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/app.js';
import {loadConfig} from '../dist/config.js';
import {applyMigrations} from '../dist/db/migrations.js';
import {ProjectRepository} from '../dist/db/projects.js';
import {JobRepository} from '../dist/jobs/job-repository.js';

const token='m'.repeat(48);
async function start(t,owner,pool) {
  const config=loadConfig({MCP_ACCESS_TOKEN:token,PUBLIC_ORIGIN:'http://127.0.0.1:3000',MCP_OWNER_KEY:owner});
  const app=createApp(config,{ownerKey:owner,projects:new ProjectRepository(pool),jobs:new JobRepository(pool)});
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
  const call=await start(t,owner,pool),otherCall=await start(t,other,pool);
  const toolList=await call('tools/list');
  const names=toolList.tools.map(x=>x.name);
  for (const name of ['workspace_create_project','workspace_list_projects','workspace_get_project',
    'workspace_rename_project','workspace_list_revisions','workspace_queue_demo','workspace_get_job'])
    assert.ok(names.includes(name),name);
  const created=output(await call('tools/call',{name:'workspace_create_project',arguments:{name:'Cube monster'}}));
  const id=created.project.id;
  t.after(async()=>{
    try {
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
  const queued=output(await call('tools/call',{name:'workspace_queue_demo',arguments:{projectId:id}}));
  assert.equal(queued.job.status,'pending');
  assert.match(queued.message,/awaiting worker/);
  assert.equal((await call('tools/call',{name:'workspace_queue_demo',arguments:{projectId:id}})).isError,true);
  assert.equal(output(await call('tools/call',{name:'workspace_get_job',arguments:{jobId:queued.job.id}})).job.status,'pending');
  assert.equal((await otherCall('tools/call',{name:'workspace_get_job',arguments:{jobId:queued.job.id}})).isError,true);
  assert.deepEqual(output(await call('tools/call',{name:'workspace_list_revisions',arguments:{projectId:id}})).revisions,[]);
  assert.equal((await call('tools/call',{name:'workspace_get_project',arguments:{projectId:'../../x'}})).isError,true);
  const denied=await call('tools/list',{},false);
  assert.equal(denied.status,401);
});
