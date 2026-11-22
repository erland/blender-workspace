import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApp} from '../dist/app.js';
import {loadConfig} from '../dist/config.js';
import {registerProjectTools} from '../dist/mcp/project-tools.js';
import {RenderArtifactStore} from '../dist/storage/render-artifacts.js';

const size=512;
const png=()=>{
  const b=Buffer.alloc(80);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(b);
  b.writeUInt32BE(13,8);
  b.write('IHDR',12,'ascii');
  b.writeUInt32BE(size,16);
  b.writeUInt32BE(size,20);
  b[24]=8;b[25]=6;
  return b;
};

function fixtures({renderStatus='completed',owner='owner-good',storedWidth=512,
                  sourceBytes=png()}={}){
  const id=randomUUID(),projectId=randomUUID(),renderRoot={};
  const stored={
    id,project_id:projectId,owner_key:owner,source_revision:1,status:renderStatus,
    engine:'CYCLES',width:storedWidth,height:512,samples:16,
    size_bytes:sourceBytes.length,
    sha256:createHash('sha256').update(sourceBytes).digest('hex')
  };
  return {id,projectId,stored,sourceBytes};
}

test('DEV-047 MCP image tool is read-only, returns actual image content and never executes Modal',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-mcp-render-image-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const f=fixtures(),store=new RenderArtifactStore(root);
  const filepath=path.join(root,'original.png');
  await writeFile(filepath,f.sourceBytes);
  const meta=await store.publish(f.projectId,f.id,filepath);
  f.stored.sha256=meta.sha256;f.stored.size_bytes=meta.sizeBytes;
  let jobReads=0,queued=0,verified=0;
  const renderJobs={
    async get(owner,id){jobReads++;return owner==='owner-good'&&id===f.id?f.stored:null;},
    async reserve(){queued++;throw Error('Must never queue Modal');}
  };
  const imageFiles={async verifiedPath(...args){
    verified++;return store.verifiedPath(...args);
  }};
  const tools=new Map();
  const deps={ownerKey:'owner-good',projects:{},jobs:{},renderJobs,renderedImages:imageFiles};
  registerProjectTools({registerTool(n,config,handler){tools.set(n,{config,handler});}},
    deps,new Set(['workspace:read']));
  assert.ok(tools.has('workspace_get_render_image'));
  const tool=tools.get('workspace_get_render_image');
  assert.equal(tool.config.annotations.readOnlyHint,true);
  const success=await tool.handler({renderJobId:f.id});
  assert.equal(success.isError,undefined);
  assert.equal(success.content.length,2);
  assert.equal(success.content[1].type,'image');
  assert.equal(success.content[1].mimeType,'image/png');
  assert.deepEqual(Buffer.from(success.content[1].data,'base64'),f.sourceBytes);
  assert.equal(JSON.parse(success.content[0].text).revision,1);
  assert.equal(JSON.parse(success.content[0].text).modalExecution,false);
  assert.equal(queued,0);
  assert.equal(jobReads,1);assert.equal(verified,1);

  // A completely separate owner cannot read render content or file paths.
  const other=new Map();
  registerProjectTools({registerTool(n,c,h){other.set(n,h);}},
    {...deps,ownerKey:'other-owner'},new Set(['workspace:read']));
  const foreign=await other.get('workspace_get_render_image')({renderJobId:f.id});
  assert.equal(foreign.isError,true);
  assert.ok(foreign.content.every(item=>item.type==='text'));
  assert.equal(verified,1);

  // OAuth missing read scope prevents database and file reads.
  const denied=new Map();
  registerProjectTools({registerTool(n,c,h){denied.set(n,h);}},
    deps,new Set(['workspace:write']));
  const before=jobReads;
  const noScope=await denied.get('workspace_get_render_image')({renderJobId:f.id});
  assert.equal(noScope.isError,true);
  assert.equal(jobReads,before);

  f.stored.status='pending';
  assert.equal((await tool.handler({renderJobId:f.id})).isError,true);
  f.stored.status='completed';
  f.stored.width=1025;
  assert.equal((await tool.handler({renderJobId:f.id})).isError,true);
  f.stored.width=512;
  f.stored.size_bytes=5*1024*1024;
  assert.equal((await tool.handler({renderJobId:f.id})).isError,true);
  f.stored.size_bytes=meta.sizeBytes;

  // Hash mismatch is a strict rejection even with unchanged PNG signature.
  await writeFile(await store.verifiedPath(f.projectId,f.id,meta.sha256,meta.sizeBytes),
    Buffer.alloc(meta.sizeBytes));
  const tampered=await tool.handler({renderJobId:f.id});
  assert.equal(tampered.isError,true);
  assert.ok(tampered.content.every(item=>item.type==='text'));
  assert.equal(queued,0);
});

test('DEV-047 MCP HTTP transport exposes PNG image to clients, not merely a URL',async t=>{
  const token='p'.repeat(48),owner='render-owner',root=await mkdtemp(path.join(os.tmpdir(),'bw-image-mcp-http-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const f=fixtures({owner}),store=new RenderArtifactStore(root);
  const file=path.join(root,'render.png');
  await writeFile(file,f.sourceBytes);
  const saved=await store.publish(f.projectId,f.id,file);
  f.stored.sha256=saved.sha256;f.stored.size_bytes=saved.sizeBytes;
  const config=loadConfig({MCP_ACCESS_TOKEN:token,PUBLIC_ORIGIN:'http://127.0.0.1:3000',MCP_OWNER_KEY:owner});
  const app=createApp(config,{ownerKey:owner,projects:{},jobs:{},
    renderJobs:{async get(w,id){return w===owner&&id===f.id?f.stored:null;}},
    renderedImages:store});
  await app.listen({port:0,host:'127.0.0.1'});
  t.after(()=>app.close());
  const endpoint='http://127.0.0.1:'+app.server.address().port+'/mcp';
  async function rpc(auth){
    const response=await fetch(endpoint,{method:'POST',headers:{
      'content-type':'application/json',accept:'application/json, text/event-stream',
      ...(auth?{authorization:'Bearer '+token}:{})
    },body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',
      params:{name:'workspace_get_render_image',arguments:{renderJobId:f.id}}})});
    if(!auth){assert.equal(response.status,401);return null;}
    assert.equal(response.status,200);
    const body=await response.text();
    const frame=body.split('\n').find(x=>x.startsWith('data:'));
    return (frame?JSON.parse(frame.slice(5)):JSON.parse(body)).result;
  }
  await rpc(false);
  const reply=await rpc(true);
  assert.equal(reply.content[1].type,'image');
  assert.equal(reply.content[1].mimeType,'image/png');
  assert.deepEqual(Buffer.from(reply.content[1].data,'base64'),f.sourceBytes);
});
