import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {applyMigrations} from '../dist/db/migrations.js';
import {ModalAccountManager} from '../dist/modal/modal-accounts.js';
import {modalJobEnv,ModalPythonExecutor} from '../dist/jobs/modal-executor.js';
import {JobOrchestrator} from '../dist/jobs/orchestrator.js';

test('per-owner Modal secrets are AES-GCM encrypted, isolated, replaceable and revocable',
  {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
  await applyMigrations(pool);
  const key=randomBytes(32),a='modal-test-'+randomUUID(),b='modal-test-'+randomUUID();
  const verifier={calls:[],async verify(creds){
    this.calls.push(creds.tokenId);
    if(creds.tokenSecret==='invalid')throw new Error('auth denied');
  }};
  const manager=new ModalAccountManager(pool,key,verifier);
  t.after(async()=>{try {
    await pool.query('DELETE FROM bw_modal_accounts WHERE owner_key=ANY($1)',[[a,b]]);
  }finally{await pool.end();}});
  assert.deepEqual(await manager.status(a),{connected:false,needsRenewal:false});
  await assert.rejects(()=>manager.saveAndTest(a,'wrong','invalid'),/auth denied/);
  assert.deepEqual(await manager.status(a),{connected:false,needsRenewal:false});
  await manager.saveAndTest(a,'ak-user-a','as-private-a');
  await manager.saveAndTest(b,'ak-user-b','as-private-b');
  const rows=await pool.query('SELECT owner_key,encode(ciphertext,\'hex\') AS ciphertext FROM bw_modal_accounts WHERE owner_key=ANY($1)',[[a,b]]);
  assert.equal(rows.rows.length,2);
  for(const row of rows.rows){assert.ok(!row.ciphertext.includes(Buffer.from('as-private').toString('hex')));}
  assert.deepEqual(await manager.requireConnected(a),{tokenId:'ak-user-a',tokenSecret:'as-private-a'});
  assert.deepEqual(await manager.requireConnected(b),{tokenId:'ak-user-b',tokenSecret:'as-private-b'});
  const other=new ModalAccountManager(pool,randomBytes(32),verifier);
  await assert.rejects(()=>other.requireConnected(a),/could not be decrypted/);
  await manager.saveAndTest(a,'ak-new','as-new');
  assert.equal((await manager.requireConnected(a)).tokenId,'ak-new');
  await manager.test(a);
  const originalVerify=verifier.verify;
  verifier.verify=async()=>{throw new Error('Temporary Modal network outage');};
  await assert.rejects(()=>manager.test(a),/validation failed/);
  assert.equal((await manager.status(a)).connected,true,'transient outages must not revoke credentials');
  verifier.verify=originalVerify;
  await pool.query('UPDATE bw_modal_accounts SET auth_tag=$2 WHERE owner_key=$1',[a,randomBytes(16)]);
  await assert.rejects(()=>manager.requireConnected(a),/could not be decrypted/);
  await manager.disconnect(a);
  assert.equal((await manager.status(a)).connected,false);
  assert.equal((await manager.status(b)).connected,true);
  await manager.saveAndTest(a,'ak-user-a','as-private-a');
  await pool.query('UPDATE bw_modal_accounts SET status=\'revoked\' WHERE owner_key=$1',[a]);
  assert.equal((await manager.status(a)).needsRenewal,true);
  await assert.rejects(()=>manager.requireConnected(a),/not connected/);
});

test('Modal identity is injected only for the requested owner; global tokens are stripped',()=>{
  const env=modalJobEnv({tokenId:'ak-owner',tokenSecret:'as-owner'},{
    MODAL_TOKEN_ID:'global',MODAL_TOKEN_SECRET:'global-secret',MODAL_OAUTH_REFRESH_TOKEN:'global-oauth',
    PATH:'/usr/bin'
  });
  assert.equal(env.MODAL_TOKEN_ID,'ak-owner');
  assert.equal(env.MODAL_TOKEN_SECRET,'as-owner');
  assert.equal(env.MODAL_OAUTH_REFRESH_TOKEN,undefined);
  assert.equal(env.PATH,'/usr/bin');
  assert.throws(()=>new ModalPythonExecutor('relative-root'));
});

test('Modal executor denies missing connected account before starting subprocess',async()=>{
  const executor=new ModalPythonExecutor('/tmp',100,undefined,false);
  await assert.rejects(()=>executor.createDemo('/tmp/unneeded','someone'),/service unavailable/);
  const disconnected=new ModalPythonExecutor('/tmp',100,{
    async requireConnected(){throw new Error('Modal account not connected');}
  });
  await assert.rejects(()=>disconnected.createDemo('/tmp/unneeded','someone'),/not connected/);
});

test('orchestrator passes claimed job owner to executor, never caller override',async()=>{
  const fakeJobs={async claim(){return {id:'job',project_id:'project',owner_key:'owner-from-job',
    expected_revision:0,requested_revision:1};},
    async finalize(){return {status:'completed'};}};
  let calledOwner;
  const executor={async createDemo(_dir,owner){calledOwner=owner;}};
  const artifacts={async publish(){}};
  const orch=new JobOrchestrator(fakeJobs,artifacts,executor);
  await orch.execute('owner-from-job','job');
  assert.equal(calledOwner,'owner-from-job');
});
