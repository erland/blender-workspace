import test from 'node:test';
import assert from 'node:assert/strict';
import {databasePoolConfig} from '../dist/db/pool-config.js';

test('DEV-037 discrete PostgreSQL settings produce a safe pg Pool config',()=>{
  const config=databasePoolConfig({
    PGHOST:'db.internal',PGPORT:'5433',PGUSER:'bw_user',
    PGPASSWORD:'password with @:/# spaces',PGDATABASE:'blender_workspace'
  },{max:2});
  assert.equal(config.host,'db.internal');
  assert.equal(config.port,5433);
  assert.equal(config.user,'bw_user');
  assert.equal(config.password,'password with @:/# spaces');
  assert.equal(config.database,'blender_workspace');
  assert.equal(config.max,2);
  assert.equal(config.connectionString,undefined);
});

test('DEV-037 rejects missing/invalid discrete credentials without echoing secrets',()=>{
  for(const input of [
    {PGHOST:'db'},
    {PGHOST:'db',PGPORT:'0',PGUSER:'u',PGPASSWORD:'secret',PGDATABASE:'db'},
    {PGHOST:'db',PGPORT:'65536',PGUSER:'u',PGPASSWORD:'secret',PGDATABASE:'db'},
    {PGHOST:'db',PGPORT:'5432',PGUSER:'u',PGPASSWORD:'secret'},
    {PGHOST:'db',PGPORT:'5432',PGUSER:'u',PGPASSWORD:'secret',PGDATABASE:'db',DATABASE_URL:'postgres://example'},
  ])assert.throws(()=>databasePoolConfig(input),error=>{
    assert.ok(!error.message.includes('secret'));
    assert.ok(!error.message.includes('postgres://'));
    return true;
  });
});

test('DEV-037 existing DATABASE_URL works, but cannot mix with PGHOST settings',()=>{
  const config=databasePoolConfig({DATABASE_URL:'postgres://user:pass@db:5432/example'});
  assert.equal(config.connectionString,'postgres://user:pass@db:5432/example');
  assert.equal(databasePoolConfig({}),undefined);
  assert.throws(()=>databasePoolConfig({DATABASE_URL:'postgres://x',PGPASSWORD:'secret'}));
});
