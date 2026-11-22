import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../dist/app.js';

const ORIGIN='https://blender-workspace.apphome.one';
const CSRF='test-only-csrf-not-a-secret';
const OWNER='oauth:'+'a'.repeat(64);

function setup(){
  const calls={save:0,test:0,disconnect:0,memory:0,selected:2048};
  const google={
    settingsSession(cookie){
      return cookie==='session=test-session'?{ownerKey:OWNER,csrf:CSRF,expires:Date.now()+60000}:undefined;
    },
    logoutSettings(){return {status:303,body:'',headers:{location:'/'}};},
    beginSettingsLogin(){return {status:302,body:'',headers:{location:'/login'}};},
    metadata(){return {};},
    jwks:{keys:[]},
    async register(){return {status:400,body:{},headers:{}};},
    async authorize(){return {status:400,body:{},headers:{}};},
    async callbackLogin(){return {status:400,body:{},headers:{}};},
    async token(){return {status:400,body:{},headers:{}};},
  };
  const app=createApp({
    authMode:'google',google:{},publicOrigin:ORIGIN,
    host:'127.0.0.1',port:3000,accessToken:''
  },{
    modalAccounts:{
      async status(){return {connected:false,needsRenewal:false};},
      async saveAndTest(){calls.save++;},
      async test(){calls.test++;},
      async disconnect(){calls.disconnect++;},
      async memoryMiB(){return calls.selected;},
      async setMemoryMiB(_who,value){calls.memory++;calls.selected=value;}
    },
    projects:{},jobs:{},artifacts:{}
  },{google});
  return {app,calls};
}

async function post(app,route,{origin='null',site='same-origin',csrf=CSRF,cookie='session=test-session',memoryMiB=undefined}={}){
  const headers={
    'content-type':'application/x-www-form-urlencoded',
    ...(origin!==null?{origin}:{}),
    ...(site!==null?{'sec-fetch-site':site}:{}),
    ...(cookie!==null?{cookie}:{})
  };
  return app.inject({
    method:'POST',url:route,headers,
    payload:new URLSearchParams({csrf,tokenId:'fake-id',tokenSecret:'fake-secret',
      ...(memoryMiB!==undefined?{memoryMiB:String(memoryMiB)}:{})}).toString()
  });
}

const routes=[
  ['/settings/modal/save','save'],
  ['/settings/modal/test','test'],
  ['/settings/modal/disconnect','disconnect'],
  ['/settings/logout','logout']
];

test('Safari null Origin plus explicit same-origin Fetch Metadata permits protected settings actions',async t=>{
  const {app,calls}=setup();t.after(()=>app.close());
  for(const [route,action] of routes){
    const result=await post(app,route);
    assert.equal(result.statusCode,303,route+': '+result.body);
    if(action!=='logout')assert.equal(calls[action],1);
  }
});

test('normal exact origin continues to work without requiring Fetch Metadata',async t=>{
  const {app,calls}=setup();t.after(()=>app.close());
  const response=await post(app,'/settings/modal/test',{origin:ORIGIN,site:null});
  assert.equal(response.statusCode,303);
  assert.equal(calls.test,1);
});

test('Safari exception rejects cross-site, none, missing and malformed Fetch Metadata',async t=>{
  const {app,calls}=setup();t.after(()=>app.close());
  for(const site of ['cross-site','same-site','none',null,'Same-Origin','']){
    const result=await post(app,'/settings/modal/save',{origin:'null',site});
    assert.equal(result.statusCode,403,String(site));
  }
  assert.equal(calls.save,0);
});

test('origin absent or unrelated origins cannot submit settings forms',async t=>{
  const {app,calls}=setup();t.after(()=>app.close());
  for(const origin of [null,'https://evil.example','https://blender-workspace.apphome.one.evil.example','']){
    const result=await post(app,'/settings/modal/test',{origin,site:'same-origin'});
    assert.equal(result.statusCode,403,String(origin));
  }
  assert.equal(calls.test,0);
});

test('the Safari exception never bypasses signed session and per-session CSRF validation',async t=>{
  const {app,calls}=setup();t.after(()=>app.close());
  for(const [options,status] of [
    [{cookie:null},401],
    [{cookie:'session=forged'},401],
    [{csrf:'incorrect'},403],
    [{csrf:''},403],
  ]){
    const result=await post(app,'/settings/modal/disconnect',options);
    assert.equal(result.statusCode,status,JSON.stringify(options));
  }
  assert.equal(calls.disconnect,0);
});

test('DEV-049 authenticated memory form is same-origin, CSRF protected and input bounded',async t=>{
  const {app,calls}=setup();t.after(()=>app.close());
  const page=await app.inject({method:'GET',url:'/settings',headers:{cookie:'session=test-session'}});
  assert.equal(page.statusCode,200);
  assert.match(page.body,/Reserverat minne per Sandbox/);
  assert.match(page.body,/<option value="2048" selected>/);
  const rejected=await post(app,'/settings/modal/memory',{memoryMiB:3072});
  assert.equal(rejected.statusCode,303);
  assert.match(rejected.headers.location,/memory_invalid/);
  assert.equal(calls.memory,0);
  for(const options of [
    {memoryMiB:4096,csrf:'bad'},
    {memoryMiB:4096,origin:'https://evil.example'},
    {memoryMiB:4096,site:'cross-site'},
    {memoryMiB:4096,cookie:null}
  ]){
    const response=await post(app,'/settings/modal/memory',options);
    assert.ok([401,403].includes(response.statusCode));
  }
  assert.equal(calls.memory,0);
  const success=await post(app,'/settings/modal/memory',{memoryMiB:4096});
  assert.equal(success.statusCode,303);
  assert.match(success.headers.location,/memory_saved/);
  assert.equal(calls.memory,1);
  assert.equal(calls.selected,4096);
  const after=await app.inject({method:'GET',url:'/settings',headers:{cookie:'session=test-session'}});
  assert.match(after.body,/<option value="4096" selected>/);
});
