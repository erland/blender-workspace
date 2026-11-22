import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {applyMigrations} from '../dist/db/migrations.js';
import {ModalAccountManager,DEFAULT_MODAL_MEMORY_MIB,
  validateModalMemoryMiB} from '../dist/modal/modal-accounts.js';
import {registerProjectTools} from '../dist/mcp/project-tools.js';

test('DEV-049 defaults to 2 GiB; rejects arbitrary reservations',()=>{
  assert.equal(DEFAULT_MODAL_MEMORY_MIB,2048);
  for(const n of [2048,4096,8192,16384])assert.equal(validateModalMemoryMiB(n),n);
  for(const n of [0,1024,3072,32768,2048.5,NaN])
    assert.throws(()=>validateModalMemoryMiB(n),/Invalid Modal memory/);
});

test('DEV-049 owner memory settings are persisted and isolated in PostgreSQL',
 {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:3});
  await applyMigrations(pool);
  const a='memory-test-'+randomUUID(),b='memory-test-'+randomUUID();
  t.after(async()=>{try{
    await pool.query('DELETE FROM bw_modal_memory_settings WHERE owner_key=ANY($1)',[[a,b]]);
  }finally{await pool.end();}});
  const accounts=new ModalAccountManager(pool,randomBytes(32),{async verify(){}});
  assert.equal(await accounts.memoryMiB(a),2048);
  assert.equal(await accounts.memoryMiB(b),2048);
  await accounts.setMemoryMiB(a,4096);
  assert.equal(await accounts.memoryMiB(a),4096);
  assert.equal(await accounts.memoryMiB(b),2048);
  await accounts.setMemoryMiB(a,8192);
  assert.equal(await accounts.memoryMiB(a),8192);
  await accounts.setMemoryMiB(b,16384);
  assert.equal(await accounts.memoryMiB(b),16384);
  await assert.rejects(()=>accounts.setMemoryMiB(a,3072),/Invalid Modal memory/);
  assert.equal(await accounts.memoryMiB(a),8192);
  await assert.rejects(()=>pool.query(
    'INSERT INTO bw_modal_memory_settings(owner_key,memory_mib) VALUES($1,$2)',
    ['db-reject-'+randomUUID(),1024]),/check constraint/i);
  await accounts.disconnect(a);
  assert.equal(await accounts.memoryMiB(a),8192,
    'Disconnecting credentials must not erase a resource preference');
});

test('DEV-049 MCP only allows own choice, read and write OAuth scopes, no Modal',async()=>{
 const owner='test-owner',prefs=new Map(),tools=new Map();
 let writes=0;
 const accounts={
   async memoryMiB(w){return prefs.get(w)??2048;},
   async setMemoryMiB(w,size){writes++;prefs.set(w,size);},
   async status(){return {connected:false,needsRenewal:false};}
 };
 const deps={ownerKey:owner,projects:{},jobs:{},modalAccounts:accounts};
 const register=(map,scope,identity=owner)=>registerProjectTools({
   registerTool(name,config,handler){map.set(name,{config,handler});}
 },{...deps,ownerKey:identity},new Set(scope));
 register(tools,['workspace:read','workspace:write']);
 const get=tools.get('workspace_get_modal_memory');
 const set=tools.get('workspace_set_modal_memory');
 assert.equal(get.config.annotations.readOnlyHint,true);
 assert.equal(JSON.parse((await get.handler({})).content[0].text).memoryMiB,2048);
 assert.equal(JSON.parse((await set.handler({memoryMiB:4096})).content[0].text).memoryMiB,4096);
 assert.equal(JSON.parse((await get.handler({})).content[0].text).memoryMiB,4096);
 assert.equal(writes,1);
 const readOnly=new Map();
 register(readOnly,['workspace:read']);
 assert.equal((await readOnly.get('workspace_set_modal_memory').handler({memoryMiB:8192})).isError,true);
 const writeOnly=new Map();
 register(writeOnly,['workspace:write']);
 assert.equal((await writeOnly.get('workspace_get_modal_memory').handler({})).isError,true);
 const foreign=new Map();
 register(foreign,['workspace:read','workspace:write'],'other-owner');
 assert.equal(JSON.parse((await foreign.get('workspace_get_modal_memory').handler({})).content[0].text).memoryMiB,2048);
 assert.equal(writes,1);
});
