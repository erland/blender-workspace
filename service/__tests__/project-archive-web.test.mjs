import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../dist/app.js';

const ORIGIN='https://blender-workspace.apphome.one',ID=randomUUID();
const OWNER='oauth:'+'a'.repeat(64),CSRF='browser-test-csrf';
test('archive browser endpoints require correct session, owner, exact origin and CSRF',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'bw-archive-web-'));
  const archive=path.join(directory,'sample.zip');
  await writeFile(archive,'fixture');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  let imported=0,exported=0;
  const google={
    settingsSession(cookie){
      return cookie==='cookie=owner'?{ownerKey:OWNER,csrf:CSRF}:
        cookie==='cookie=other'?{ownerKey:'oauth:'+'b'.repeat(64),csrf:CSRF}:undefined;
    },
    beginSettingsLogin(){return {status:302,body:'',headers:{location:'/settings/login'}};},
    metadata(){return {};},jwks:{keys:[]}
  };
  const projects={
    async get(owner,id){return owner===OWNER&&id===ID
      ?{id:ID,name:'Saved',description:'Test',current_revision:0,updated_at:new Date()}:null;},
    async list(owner){return owner===OWNER?[await this.get(OWNER,ID)]:[];},
    async revisions(){return [];}
  };
  const app=createApp({authMode:'google',google:{},publicOrigin:ORIGIN,
      host:'127.0.0.1',port:3000,accessToken:''},
    {projects,jobs:{},modalAccounts:{
      async status(){return {connected:false,needsRenewal:false};}
    },projectArchive:{
      async export(owner,id){
        if(owner!==OWNER||id!==ID)throw new Error('Not found');
        exported++;return {archive,directory};
      },
      async import(owner,bytes){
        if(owner!==OWNER)throw new Error('Not owner');
        assert.ok(Buffer.isBuffer(bytes));imported++;
        return ID;
      }
    }},{google});
  t.after(()=>app.close());
  const exportUrl='/projects/'+ID+'/export';
  assert.equal((await app.inject({method:'GET',url:exportUrl})).statusCode,302);
  assert.equal((await app.inject({method:'GET',url:exportUrl,headers:{cookie:'cookie=other'}})).statusCode,422);
  assert.equal(exported,0);
  const okay=await app.inject({method:'GET',url:exportUrl,headers:{cookie:'cookie=owner'}});
  assert.equal(okay.statusCode,200);
  assert.match(okay.headers['content-disposition'],/attachment/);
  assert.equal(okay.body,'fixture');
  assert.equal(exported,1);
  const upload=(headers={})=>app.inject({method:'POST',url:'/projects/import',
    headers:{'content-type':'application/vnd.blender-workspace.project+zip',...headers},
    payload:Buffer.from('PK fake zip')});
  assert.equal((await upload()).statusCode,401);
  assert.equal((await upload({cookie:'cookie=owner',origin:'https://attacker.test',
    'x-csrf-token':CSRF})).statusCode,403);
  assert.equal((await upload({cookie:'cookie=owner',origin:ORIGIN,
    'x-csrf-token':'bad'})).statusCode,403);
  assert.equal((await upload({cookie:'cookie=owner',origin:'null',
    'sec-fetch-site':'cross-site','x-csrf-token':CSRF})).statusCode,403);
  assert.equal((await upload({cookie:'cookie=other',origin:ORIGIN,
    'x-csrf-token':CSRF})).statusCode,422);
  assert.equal(imported,0);
  const importedResponse=await upload({cookie:'cookie=owner',origin:'null',
    'sec-fetch-site':'same-origin','x-csrf-token':CSRF});
  assert.equal(importedResponse.statusCode,201,importedResponse.body);
  assert.equal(importedResponse.json().projectId,ID);
  assert.equal(imported,1);
  const portal=await app.inject({method:'GET',url:'/',headers:{cookie:'cookie=owner'}});
  assert.ok(portal.body.includes('href="/projects/import"'));
  assert.doesNotMatch(portal.body,/id="import-project-form"/);
  const importDenied=await app.inject({method:'GET',url:'/projects/import'});
  assert.equal(importDenied.statusCode,302);
  const importPage=await app.inject({method:'GET',url:'/projects/import',headers:{cookie:'cookie=owner'}});
  assert.equal(importPage.statusCode,200);
  assert.match(importPage.body,/id="import-project-form"/);
  assert.match(importPage.body,/name="csrf" value="browser-test-csrf"/);
  assert.match(importPage.headers['content-security-policy'],/connect-src 'self'/);
  assert.ok(importPage.body.includes('/archive/assets/import.js'));
});
