import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { loadConfig, authorized } from '../dist/config.js';

const token = 'c'.repeat(48);
const config = () => loadConfig({ MCP_ACCESS_TOKEN:token, PUBLIC_ORIGIN:'http://127.0.0.1:3000', HOST:'127.0.0.1', PORT:'3000' });

test('rejects weak secrets and non-HTTPS public origins', () => {
  assert.throws(() => loadConfig({MCP_ACCESS_TOKEN:'short',PUBLIC_ORIGIN:'https://example.com'}));
  assert.throws(() => loadConfig({MCP_ACCESS_TOKEN:token,PUBLIC_ORIGIN:'http://example.com'}));
  assert.equal(authorized('Bearer '+token,token),true);
  assert.equal(authorized('Bearer wrong',token),false);
});
test('public liveness and readiness report no integration', async t => {
  const app=createApp(config()); t.after(()=>app.close());
  const live=await app.inject('/health/live');
  assert.equal(live.statusCode,200);
  assert.equal(live.json().status,'alive');
  const ready=await app.inject('/health/ready');
  assert.equal(ready.statusCode,200);
  assert.equal(ready.json().integrations,'not_configured');
});
test('MCP route rejects unauthorized clients and bad origins', async t => {
  const app=createApp(config()); t.after(()=>app.close());
  const body={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}};
  const one=await app.inject({method:'POST',url:'/mcp',payload:body});
  assert.equal(one.statusCode,401);
  const two=await app.inject({method:'POST',url:'/mcp',headers:{authorization:'Bearer '+token,origin:'https://evil.test'},payload:body});
  assert.equal(two.statusCode,403);
  const three=await app.inject({method:'GET',url:'/mcp',headers:{authorization:'Bearer '+token}});
  assert.equal(three.statusCode,405);
});
test('MCP initialize request over HTTP succeeds', async t => {
  const app=createApp(config());
  await app.listen({port:0,host:'127.0.0.1'});
  t.after(()=>app.close());
  const address=app.server.address();
  const body={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}};
  const response=await fetch('http://127.0.0.1:'+address.port+'/mcp',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','accept':'application/json, text/event-stream'},body:JSON.stringify(body)});
  const text=await response.text();
  assert.equal(response.status,200,text);
  assert.match(text,/blender-workspace/);
});
