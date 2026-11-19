import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../dist/app.js';

const ORIGIN='https://blender-workspace.apphome.one';
const CSRF='test-only-csrf-not-a-secret';
const OWNER='oauth:'+'a'.repeat(64);

function setup(){
  const calls={save:0,test:0,disconnect:0};
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
      async disconnect(){calls.disconnect++;}
    },
    projects:{},jobs:{},artifacts:{}
  },{google});
  return {app,calls};
}

async function post(app,route,{origin='null',site='same-origin',csrf=CSRF,cookie='session=test-session'}={}){
  const headers={
    'content-type':'application/x-www-form-urlencoded',
    ...(origin!==undefined?{origin}:{}),
    ...(site!==undefined?{'sec-fetch-site':site}:{}),
    ...(cookie!==undefined?{cookie}:{})
  };
  return app.inject({
    method:'POST',url:route,headers,
    payload:new URLSearchParams({csrf,tokenId:'fake-id',tokenSecret:'fake-secret'}).toString()
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
  const response=await post(app,'/settings/modal/test',{origin:ORIGIN,site:undefined});
  assert.equal(response.statusCode,303);
  assert.equal(calls.test,1);
});

test('Safari exception rejects cross-site, none, missing and malformed Fetch Metadata',async t=>{
  const {app,calls}=setup();t.after(()=>app.close());
  for(const site of ['cross-site','same-site','none',undefined,'Same-Origin','']){
    const result=await post(app,'/settings/modal/save',{origin:'null',site});
    assert.equal(result.statusCode,403,String(site));
  }
  assert.equal(calls.save,0);
});

test('origin absent or unrelated origins cannot submit settings forms',async t=>{
  const {app,calls}=setup();t.after(()=>app.close());
  for(const origin of [undefined,'https://evil.example','https://blender-workspace.apphome.one.evil.example','']){
    const result=await post(app,'/settings/modal/test',{origin,site:'same-origin'});
    assert.equal(result.statusCode,403,String(origin));
  }
  assert.equal(calls.test,0);
});

test('the Safari exception never bypasses signed session and per-session CSRF validation',async t=>{
  const {app,calls}=setup();t.after(()=>app.close());
  for(const [options,status] of [
    [{cookie:undefined},401],
    [{cookie:'session=forged'},401],
    [{csrf:'incorrect'},403],
    [{csrf:''},403],
  ]){
    const result=await post(app,'/settings/modal/disconnect',options);
    assert.equal(result.statusCode,status,JSON.stringify(options));
  }
  assert.equal(calls.disconnect,0);
});
