import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApp} from '../dist/app.js';
import {loadConfig} from '../dist/config.js';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';

const access='x'.repeat(48),origin='http://127.0.0.1:3000';
const config=loadConfig({MCP_ACCESS_TOKEN:access,PUBLIC_ORIGIN:origin,MCP_OWNER_KEY:'owner-a'});
async function rpc(app,method,params={}){
  const response=await app.inject({method:'POST',url:'/mcp',
    headers:{authorization:'Bearer '+access,
      accept:'application/json, text/event-stream','content-type':'application/json'},
    payload:{jsonrpc:'2.0',id:1,method,params}});
  assert.equal(response.statusCode,200,response.body);
  const body=response.body;
  const frame=body.split('\\n').find(x=>x.startsWith('data:'));
  return (frame?JSON.parse(frame.slice(5)):JSON.parse(body)).result;
}
function data(reply){return JSON.parse(reply.content[0].text);}
test('DEV-020 MCP links only verified owned committed GLB revisions',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-mcp-viewer-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const store=new LocalArtifactStore(root);
  const projectId=randomUUID(),otherId=randomUUID();
  const source=path.join(root,'source.glb');
  await writeFile(source,'valid GLB fixture');
  await store.publish({projectId,revision:1,expectedPreviousRevision:0,
    artifacts:[{name:'scene.glb',sourcePath:source}]});
  const jobs={
    async get(owner,jobId){
      if(owner!=='owner-a')return null;
      if(jobId==='11111111-1111-4111-8111-111111111111')
        return {id:jobId,project_id:projectId,status:'completed',requested_revision:1};
      if(jobId==='22222222-2222-4222-8222-222222222222')
        return {id:jobId,project_id:projectId,status:'pending',requested_revision:2};
      return null;
    }
  };
  const projects={
    async get(owner,id){return owner==='owner-a'&&id===projectId?{id}:null;},
    async revisions(owner,id){return owner==='owner-a'&&id===projectId?
      [{revision:1,artifact_prefix:id+'/00000001'}]:[];}
  };
  // Passing a mock Google settings server enables the read-only link feature.
  // The actual browser route still independently checks the Google session.
  const app=createApp(config,{ownerKey:'owner-a',projects,jobs,artifacts:store},
    {google:{settingsSession:()=>undefined}});
  t.after(()=>app.close());
  const tools=await rpc(app,'tools/list');
  assert.ok(tools.tools.some(x=>x.name==='workspace_get_viewer_link'));
  const args={projectId,revision:1};
  const link=data(await rpc(app,'tools/call',{name:'workspace_get_viewer_link',arguments:args}));
  assert.equal(link.viewerUrl,origin+'/viewer/'+projectId+'/revisions/1');
  assert.equal(link.requiresGoogleLogin,true);
  assert.equal(link.modalExecution,false);
  assert.doesNotMatch(JSON.stringify(link),/Bearer|session|secret|token/i);
  const completed=data(await rpc(app,'tools/call',{name:'workspace_get_job',
    arguments:{jobId:'11111111-1111-4111-8111-111111111111'}}));
  assert.equal(completed.viewerUrl,link.viewerUrl);
  const pending=data(await rpc(app,'tools/call',{name:'workspace_get_job',
    arguments:{jobId:'22222222-2222-4222-8222-222222222222'}}));
  assert.equal(pending.viewerUrl,undefined);
  for(const bad of [{projectId:otherId,revision:1},{projectId,revision:2}]){
    const fail=await rpc(app,'tools/call',{name:'workspace_get_viewer_link',arguments:bad});
    assert.equal(fail.isError,true);
    assert.equal(fail.content[0].text,'Saved GLB revision not found');
  }
  const file=await store.verifiedArtifactPath(projectId,1,'scene.glb');
  await writeFile(file,'tampered');
  const corrupted=await rpc(app,'tools/call',{name:'workspace_get_viewer_link',arguments:args});
  assert.equal(corrupted.isError,true);
  const stale=data(await rpc(app,'tools/call',{name:'workspace_get_job',
    arguments:{jobId:'11111111-1111-4111-8111-111111111111'}}));
  assert.equal(stale.viewerUrl,undefined);
});
test('DEV-020 does not advertise browser link tool when Google viewer is disabled',async t=>{
  const app=createApp(config,{ownerKey:'owner-a',projects:{},jobs:{}});
  t.after(()=>app.close());
  const result=await rpc(app,'tools/list');
  assert.ok(!result.tools.some(x=>x.name==='workspace_get_viewer_link'));
});
