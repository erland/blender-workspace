import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet} from 'jose';
import pg from 'pg';
import {createApp} from '../dist/app.js';
import {loadConfig} from '../dist/config.js';
import {applyMigrations} from '../dist/db/migrations.js';
import {ProjectRepository} from '../dist/db/projects.js';
import {JobRepository} from '../dist/jobs/job-repository.js';

test('OAuth users stay isolated and read-only grants cannot create or queue', {skip:!process.env.TEST_DATABASE_URL},async t=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:5});
 await applyMigrations(pool);
 const projects=new ProjectRepository(pool);
 const jobs=new JobRepository(pool);
 const {publicKey,privateKey}=await generateKeyPair('RS256');
 const jwk=await exportJWK(publicKey);jwk.alg='RS256';jwk.kid='key';jwk.use='sig';
 const keys=createLocalJWKSet({keys:[jwk]});
 const publicOrigin='http://127.0.0.1:3000';
 const issuer='https://issuer.example.org';
 const cfg=loadConfig({NODE_ENV:'test',OAUTH_ALLOW_LOCAL_TEST:'true',PUBLIC_ORIGIN:publicOrigin,
   MCP_AUTH_MODE:'oauth',OAUTH_ISSUER:issuer,OAUTH_JWKS_URI:'https://issuer.example.org/jwks'});
 const app=createApp(cfg,{projects,jobs},{keys});
 await app.listen({host:'127.0.0.1',port:0});
 let createdId;
 t.after(async()=>{
   try {
     if(createdId){
       await pool.query('DELETE FROM bw_jobs WHERE project_id=$1',[createdId]);
       await pool.query('DELETE FROM bw_project_revisions WHERE project_id=$1',[createdId]);
       await pool.query('DELETE FROM bw_projects WHERE id=$1',[createdId]);
     }
   }finally{await app.close();await pool.end();}
 });
 let seq=1;
 async function issue(sub,scope='workspace:read workspace:write'){
   return new SignJWT({scope}).setProtectedHeader({alg:'RS256',kid:'key'})
     .setIssuer(issuer).setSubject(sub).setAudience(publicOrigin).setIssuedAt().setExpirationTime('1h')
     .sign(privateKey);
 }
 async function call(token,name,args={}){
   const response=await fetch('http://127.0.0.1:'+app.server.address().port+'/mcp',{
     method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',
       accept:'application/json, text/event-stream'},
     body:JSON.stringify({jsonrpc:'2.0',id:seq++,method:'tools/call',
       params:{name,arguments:args}})});
   const raw=await response.text();assert.equal(response.status,200,raw);
   const line=raw.split('\n').find(x=>x.startsWith('data:'));
   const parsed=line?JSON.parse(line.slice(5)):JSON.parse(raw);
   return parsed.result;
 }
 function output(reply){assert.equal(reply.isError,undefined,JSON.stringify(reply));
   return JSON.parse(reply.content[0].text);}
 const alice=await issue('alice');
 const bob=await issue('bob');
 const readonly=await issue('alice','workspace:read');
 createdId=output(await call(alice,'workspace_create_project',{name:'Private model'})).project.id;
 assert.ok(output(await call(alice,'workspace_list_projects')).projects.some(p=>p.id===createdId));
 assert.ok(!output(await call(bob,'workspace_list_projects')).projects.some(p=>p.id===createdId));
 assert.equal((await call(bob,'workspace_get_project',{projectId:createdId})).isError,true);
 assert.equal((await call(bob,'workspace_queue_demo',{projectId:createdId})).isError,true);
 assert.equal((await call(readonly,'workspace_create_project',{name:'Forbidden'})).isError,true);
 assert.equal((await call(readonly,'workspace_queue_demo',{projectId:createdId})).isError,true);
 assert.equal(output(await call(readonly,'workspace_get_project',{projectId:createdId})).project.id,createdId);
 const queued=output(await call(alice,'workspace_queue_demo',{projectId:createdId})).job;
 assert.equal(queued.status,'pending');
 assert.equal((await call(bob,'workspace_get_job',{jobId:queued.id})).isError,true);
});
