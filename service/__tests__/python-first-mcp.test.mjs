import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {registerProjectTools} from '../dist/mcp/project-tools.js';
import {parsePythonScript} from '../dist/jobs/python-script.js';

function setup({revision=0,connected=true}={}){
  const tools=new Map(),projectId=randomUUID(),owner='owner-test';
  let queued=null,checked=0;
  const server={registerTool(name,config,handler){
    if(tools.has(name))throw new Error('duplicate tool: '+name);
    tools.set(name,{config,handler});
  }};
  registerProjectTools(server,{
    ownerKey:owner,
    projects:{
      async get(w,id){return w===owner&&id===projectId?{id,current_revision:revision}:null;},
      async revisions(){return revision===0?[]:[{revision,artifact_prefix:'saved'}];}
    },
    jobs:{async reserve(...args){queued=args;return {id:randomUUID(),project_id:projectId,
      status:'pending',requested_revision:revision+1};}},
    modalAccounts:{async status(){return {connected};}},
    artifacts:{async verifiedArtifactPath(){checked++;return '/verified/predecessor.blend';}},
    viewerOrigin:'https://blender.example.test'
  },new Set(['workspace:read','workspace:write']));
  return {tools,projectId,get queued(){return queued;},get checked(){return checked;}};
}
const readResult=r=>JSON.parse(r.content[0].text);

test('DEV-033 only Python is exposed for model creation or editing',()=>{
  const {tools}=setup();
  const names=[...tools.keys()];
  assert.ok(names.includes('workspace_queue_python_script'));
  assert.ok(names.includes('workspace_inspect_scene'));
  assert.ok(names.includes('workspace_inspect_geometry'));
  assert.ok(names.includes('workspace_validate_model'));
  assert.ok(names.includes('workspace_list_materials'));
  assert.ok(names.includes('workspace_get_viewer_link'));
  for(const obsolete of ['workspace_queue_scene_operation','workspace_queue_demo',
    'workspace_queue_recolor_blue','workspace_queue_scene_edit']){
    assert.equal(tools.has(obsolete),false);
  }
  assert.equal(names.filter(n=>n.startsWith('workspace_queue_')).length,1);
});

test('DEV-033 initial script queues through existing owner-scoped job contract',async()=>{
  const context=setup();
  const code='import bpy\nbpy.ops.mesh.primitive_cube_add()';
  const handler=context.tools.get('workspace_queue_python_script').handler;
  const response=readResult(await handler({projectId:context.projectId,expectedRevision:0,code}));
  assert.equal(response.execution,'modal-sandbox');
  assert.equal(response.job.requestedRevision,1);
  assert.equal(context.queued[0],'owner-test');
  assert.equal(context.queued[2],0);
  assert.deepEqual(context.queued[5],parsePythonScript({kind:'python_script',code}));
  assert.equal(context.checked,0);
});

test('DEV-033 predecessor is verified and rejection never queues',async()=>{
  const context=setup({revision:2});
  const handler=context.tools.get('workspace_queue_python_script').handler;
  const code='import bpy\nbpy.data.objects.clear()';
  const denied=await handler({projectId:context.projectId,expectedRevision:1,code});
  assert.equal(denied.isError,true);
  assert.equal(context.queued,null);
  const accepted=await handler({projectId:context.projectId,expectedRevision:2,code});
  assert.ok(!accepted.isError);
  assert.equal(context.checked,1);
  assert.equal(context.queued[2],2);
  const bad=await handler({projectId:randomUUID(),expectedRevision:2,code});
  assert.equal(bad.isError,true);
  assert.equal(context.checked,1);
});

test('DEV-033 no connected Modal account means no executable Python job',async()=>{
  const context=setup({connected:false});
  const response=await context.tools.get('workspace_queue_python_script').handler({
    projectId:context.projectId,expectedRevision:0,code:'print(1)'});
  assert.equal(response.isError,true);
  assert.equal(context.queued,null);
});
