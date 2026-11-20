import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/app.js';

const ORIGIN='https://blender-workspace.apphome.one';
const ID=randomUUID();
const OWNER='oauth:'+'a'.repeat(64), OTHER='oauth:'+'b'.repeat(64);
const CSRF='opaque-safe-csrf';
function fixture(t){
  const state={name:'Cube & Cylinder',deleted:false,busy:false,rename:0,delete:0};
  const google={
    settingsSession(cookie){
      const who=cookie==='session=owner'?OWNER:cookie==='session=other'?OTHER:null;
      return who?{ownerKey:who,csrf:CSRF,expires:Date.now()+60000}:undefined;
    },
    beginSettingsLogin(){return {status:302,body:'',headers:{location:'/login'}};},
    logoutSettings(){return {status:303,body:'',headers:{location:'/'}};},
    metadata(){return {};},jwks:{keys:[]},
    async register(){return {status:400,body:{},headers:{}};},
    async authorize(){return {status:400,body:{},headers:{}};},
    async callbackLogin(){return {status:400,body:{},headers:{}};},
    async token(){return {status:400,body:{},headers:{}};}
  };
  const projects={
    async get(owner,id){return owner===OWNER&&id===ID&&!state.deleted
      ?{id:ID,name:state.name,description:'Owner only',current_revision:1,updated_at:new Date()}:null;},
    async revisions(owner,id){return owner===OWNER&&id===ID&&!state.deleted
      ?[{revision:1,note:'Revision <one>',artifact_prefix:'saved',created_at:new Date()}]:[];},
    async list(owner){return owner===OWNER&&!state.deleted?[await this.get(owner,ID)]:[];},
    async rename(owner,id,name){
      if(owner!==OWNER||id!==ID||state.deleted)return null;
      state.rename++;state.name=name;
      return this.get(owner,id);
    },
    async softDelete(){throw Error('Legacy soft delete must not be called');}
  };
  const app=createApp({authMode:'google',google:{},publicOrigin:ORIGIN,
      host:'127.0.0.1',port:3000,accessToken:''},
    {modalAccounts:{async status(){return {connected:false,needsRenewal:false};}},
      projects,jobs:{},projectDeletion:{async delete(owner,id){
        if(owner!==OWNER||id!==ID||state.deleted)return 'missing';
        if(state.busy)return 'busy';
        state.delete++;state.deleted=true;return 'deleted';
      }}},{google});
  t.after(()=>app.close());
  const post=(route,values={},opts={})=>app.inject({
    method:'POST',url:route,headers:{
      cookie:opts.cookie===undefined?'session=owner':opts.cookie,
      'content-type':opts.contentType??'application/x-www-form-urlencoded',
      ...(opts.origin===undefined?{origin:ORIGIN}:opts.origin===null?{}:{origin:opts.origin}),
      ...(opts.site?{'sec-fetch-site':opts.site}:{})
    },payload:new URLSearchParams({csrf:CSRF,...values}).toString()
  });
  return {app,state,post};
}

test('rename uses signed owner session, CSRF and validated form; no executable HTML',async t=>{
  const {app,state,post}=fixture(t);
  const before=await app.inject({method:'GET',url:'/projects/'+ID,
    headers:{cookie:'session=owner'}});
  assert.equal(before.statusCode,200);
  assert.match(before.body,/name="csrf"/);
  assert.match(before.body,/Byt namn/);
  const target='/projects/'+ID+'/rename';
  for(const opts of [
    {cookie:'session=other'}, {cookie:'session=forged'},
    {origin:'https://attacker.invalid'}, {origin:null},
    {origin:'null',site:'cross-site'}
  ]){
    const r=await post(target,{name:'Hacked'},opts);
    assert.ok([401,403,404].includes(r.statusCode),r.statusCode+':'+r.body);
  }
  assert.equal((await post(target,{csrf:'bad',name:'No'})).statusCode,403);
  assert.equal((await post(target,{name:''})).statusCode,303);
  assert.equal((await post(target,{name:'a'.repeat(201)})).statusCode,303);
  assert.equal(state.rename,0);
  const safari=await post(target,{name:'New <script>alert(1)</script>'},
    {origin:'null',site:'same-origin'});
  assert.equal(safari.statusCode,303);
  assert.equal(safari.headers.location,'/projects/'+ID+'?message=renamed');
  assert.equal(state.rename,1);
  const page=await app.inject({method:'GET',url:'/projects/'+ID,
    headers:{cookie:'session=owner'}});
  assert.match(page.body,/New &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(page.body,/<script>alert/);
});

test('delete requires confirmation page, checkbox, owner and csrf; missing and cross-origin requests are rejected',async t=>{
  const {app,state,post}=fixture(t);
  const target='/projects/'+ID+'/delete';
  const confirmation=await app.inject({method:'GET',url:target,
    headers:{cookie:'session=owner'}});
  assert.equal(confirmation.statusCode,200);
  assert.match(confirmation.body,/Cube &amp; Cylinder/);
  assert.match(confirmation.body,/name="confirm"/);
  assert.match(confirmation.body,/raderas permanent/);
  assert.match(confirmation.body,/name="csrf"/);
  assert.equal(state.deleted,false);
  assert.equal((await app.inject({method:'GET',url:target,
    headers:{cookie:'session=other'}})).statusCode,404);
  assert.equal((await post(target,{})).statusCode,400);
  assert.equal((await post(target,{confirm:'no'})).statusCode,400);
  assert.equal((await post(target,{confirm:'yes',csrf:'wrong'})).statusCode,403);
  assert.equal((await post(target,{confirm:'yes'},{origin:null})).statusCode,403);
  assert.equal((await post(target,{confirm:'yes'},{origin:'https://bad.example'})).statusCode,403);
  assert.equal((await post(target,{confirm:'yes'},{cookie:'session=other'})).statusCode,404);
  assert.equal(state.delete,0);
  state.busy=true;
  const blocked=await post(target,{confirm:'yes'});
  assert.equal(blocked.statusCode,303);
  assert.equal(blocked.headers.location,target+'?message=busy');
  assert.equal(state.deleted,false);
  const blockedPage=await app.inject({method:'GET',url:target+'?message=busy',
    headers:{cookie:'session=owner'}});
  assert.match(blockedPage.body,/aktivt eller återställningskrävande jobb/);
  state.busy=false;
  const ok=await post(target,{confirm:'yes'},{origin:'null',site:'same-origin'});
  assert.equal(ok.statusCode,303);
  assert.equal(ok.headers.location,'/');
  assert.equal(state.delete,1);
  assert.equal((await app.inject({method:'GET',url:'/projects/'+ID,
    headers:{cookie:'session=owner'}})).statusCode,404);
  assert.equal((await post(target,{confirm:'yes'})).statusCode,404);
});

test('cross-site and invalid parameter rejection does not mutate projects',async t=>{
  const {app,state,post}=fixture(t);
  assert.equal((await post('/projects/not-an-id/rename',{name:'x'})).statusCode,404);
  assert.equal((await post('/projects/not-an-id/delete',{confirm:'yes'})).statusCode,404);
  assert.equal((await post('/projects/'+ID+'/rename',{name:'x'},
    {origin:'null',site:'none'})).statusCode,403);
  assert.equal((await post('/projects/'+ID+'/delete',{confirm:'yes'},
    {origin:'null',site:'same-site'})).statusCode,403);
  assert.equal(state.rename,0);
  assert.equal(state.delete,0);
  const home=await app.inject({method:'GET',url:'/',headers:{cookie:'session=other'}});
  assert.doesNotMatch(home.body,/Cube &amp; Cylinder/);
});
