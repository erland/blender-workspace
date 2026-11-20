import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/app.js';

const OWNER='oauth:'+'a'.repeat(64),OTHER='oauth:'+'b'.repeat(64);
const PROJECT=randomUUID(), MODEL=randomUUID(),RENDER=randomUUID();
const ORIGIN='https://blender-workspace.apphome.one';
const google={
 settingsSession(cookie){return cookie==='session=owner'?{ownerKey:OWNER,csrf:'csrf'}:
   cookie==='session=other'?{ownerKey:OTHER,csrf:'csrf'}:undefined;},
 beginSettingsLogin(){return {status:302,body:'',headers:{location:'/settings/login'}};},
 metadata(){return {};},jwks:{keys:[]}
};
const project={id:PROJECT,name:'Katt & <test>',description:'',current_revision:2,updated_at:new Date()};
test('owner-scoped web job monitor merges model and render history, escapes text, and refreshes while active',async t=>{
 const seen=[];
 const app=createApp({authMode:'google',google:{},publicOrigin:ORIGIN,host:'127.0.0.1',port:3000,accessToken:''},{
  modalAccounts:{async status(){return {connected:true,needsRenewal:false};}},
  projects:{
   async list(owner){seen.push(['projects',owner]);return owner===OWNER?[project]:[];},
   async get(owner,id){return owner===OWNER&&id===PROJECT?project:null;},
   async revisions(owner,id){return owner===OWNER&&id===PROJECT
     ?[{revision:2,note:'Model',created_at:new Date(),artifact_prefix:PROJECT+'/00000002'}]:[];}
  },
  jobs:{
   async list(owner,id){seen.push(['models',owner,id]);return owner===OWNER?
    [{id:MODEL,project_id:PROJECT,requested_revision:2,status:'running',
      note:'Päls <script>alert(1)</script>',error_message:null,created_at:new Date()}]:[];}
  },
  renderJobs:{
   async listForOwner(owner){seen.push(['renders',owner]);return owner===OWNER?
    [{id:RENDER,project_id:PROJECT,source_revision:1,status:'completed',
      engine:'CYCLES',width:512,height:512,samples:16,created_at:new Date(),error_code:null}]:[];},
   async list(owner,id){return owner===OWNER&&id===PROJECT?
    [{id:RENDER,project_id:PROJECT,source_revision:1,status:'completed',
      engine:'CYCLES',width:512,height:512,samples:16,created_at:new Date(),error_code:null}]:[];}
  },
  artifacts:{async inspect(){return {artifacts:[{name:'scene.blend'}]};}}
 },{google});
 t.after(()=>app.close());
 const get=(url,cookie)=>app.inject({method:'GET',url,headers:cookie?{cookie}:{}});
 const anon=await get('/jobs');
 assert.equal(anon.statusCode,302);
 assert.match(anon.headers.location,/settings\/login/);
 const other=await get('/jobs','session=other');
 assert.equal(other.statusCode,200);
 assert.doesNotMatch(other.body,/Katt &amp;/);
 const response=await get('/jobs','session=owner');
 assert.equal(response.statusCode,200);
 assert.match(response.headers['cache-control'],/no-store/);
 assert.match(response.body,/<meta http-equiv="refresh" content="10">/);
 assert.match(response.body,/Modellering/);
 assert.match(response.body,/Rendering/);
 assert.match(response.body,/Visa PNG/);
 assert.match(response.body,/Katt &amp; &lt;test&gt;/);
 assert.match(response.body,/Päls &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
 assert.doesNotMatch(response.body,/<script>alert/);
 assert.equal(seen.some(x=>x[0]==='models'&&x[1]===OTHER),true);
 const detail=await get('/projects/'+PROJECT,'session=owner');
 assert.equal(detail.statusCode,200);
 assert.match(detail.body,/Modelleringsjobb/);
 assert.match(detail.body,/Renderingsjobb och bilder/);
 assert.match(detail.body,/href="\/jobs"/);
 assert.match(detail.body,/<meta http-equiv="refresh" content="10">/);
 assert.equal((await get('/projects/'+PROJECT,'session=other')).statusCode,404);
});
