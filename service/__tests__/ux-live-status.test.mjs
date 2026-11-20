import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/app.js';
import {projectDetailPage,jobsOverviewPage} from '../dist/web/project-pages.js';
import {liveStatusScript} from '../dist/web/live-status.js';

const pid=randomUUID(),jid=randomUUID(),rid=randomUUID();
const time=new Date('2026-11-20T12:00:00Z');
const project={id:pid,name:'Katt',description:'',current_revision:1,updated_at:time};
const revs=[{revision:1,note:'',artifact_prefix:pid+'/00000001',created_at:time,glbAvailable:true}];
const model={id:jid,project_id:pid,requested_revision:1,status:'running',note:'Python',error_message:null,created_at:time};
const render={id:rid,source_revision:1,engine:'CYCLES',width:256,height:256,samples:16,status:'running',created_at:time};
test('UX-006 job monitor exposes bounded update regions and retains user-operated archive',()=>{
 const html=jobsOverviewPage([
  {id:jid,project_id:pid,project_name:'Katt',type:'model',revision:1,status:'running',created_at:time,detail:'Python',error:null},
  {id:rid,project_id:pid,project_name:'Katt',type:'render',revision:1,status:'completed',created_at:time,detail:'Cycles',error:null}
 ]);
 for(const id of ['live-job-sections','live-job-archive','live-job-completed','live-update-message'])
   assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(html,/portal\/assets\/live-status\.js/);
 assert.doesNotMatch(html,/<meta http-equiv="refresh"/);
});
test('UX-006 rendering and modeling views poll independently, without remounting forms',()=>{
 const imageHtml=projectDetailPage(project,revs,'csrf',undefined,[render],[model],'images');
 const modelHtml=projectDetailPage(project,revs,'csrf',undefined,[render],[model],'history');
 const overview=projectDetailPage(project,revs,'csrf',undefined,[render],[model],'overview');
 assert.match(imageHtml,/id="live-project-render-jobs"/);
 assert.match(modelHtml,/id="live-project-model-jobs"/);
 assert.match(imageHtml,/name="engine"/);
 assert.match(imageHtml,/portal\/assets\/live-status\.js/);
 assert.match(modelHtml,/portal\/assets\/live-status\.js/);
 assert.doesNotMatch(overview,/portal\/assets\/live-status\.js/);
 assert.doesNotMatch(modelHtml,/<meta http-equiv="refresh"/);
});
test('UX-006 script never navigates or reloads and pauses when hidden',()=>{
 assert.match(liveStatusScript,/fetch\(url,\{credentials:'same-origin',cache:'no-store'/);
 assert.match(liveStatusScript,/DOMParser/);
 assert.match(liveStatusScript,/replaceChildren/);
 assert.match(liveStatusScript,/document\.hidden/);
 assert.match(liveStatusScript,/current\.contains\(document\.activeElement\)/);
 assert.match(liveStatusScript,/archive\.querySelector\('summary'\)/);
 assert.match(liveStatusScript,/pagehide/);
 assert.doesNotMatch(liveStatusScript,/(?:location|window\.location)\.(?:reload|assign|replace)\(|document\.write\(/);
});
test('UX-006 script uses only same-origin resources with restrictive CSP',async t=>{
 const owner='oauth:'+'a'.repeat(64);
 const google={settingsSession(cookie){return cookie==='session=owner'?{ownerKey:owner,csrf:'secret'}:undefined;}};
 const app=createApp({authMode:'google',google:{},publicOrigin:'https://blender-workspace.apphome.one',
  host:'127.0.0.1',port:3000,accessToken:''},{
   modalAccounts:{async status(){return {connected:false,needsRenewal:false};}},
   projects:{async list(){return [project];},async get(k,id){return k===owner&&id===pid?project:null;},async revisions(){return revs;}},
   jobs:{async list(){return [model];}},
   renderJobs:{async listForOwner(){return [];},async list(){return [render];}},
   artifacts:{async inspect(){return {artifacts:[{name:'scene.glb'}]};}}
 },{google});
 t.after(()=>app.close());
 const script=await app.inject({method:'GET',url:'/portal/assets/live-status.js'});
 assert.equal(script.statusCode,200);
 assert.match(script.headers['content-type'],/application\/javascript/);
 assert.match(script.headers['content-security-policy'],/default-src 'none'/);
 assert.doesNotMatch(script.body,/secret/);
 for(const url of ['/jobs','/projects/'+pid+'?view=images','/projects/'+pid+'?view=history']){
   const r=await app.inject({method:'GET',url,headers:{cookie:'session=owner'}});
   assert.equal(r.statusCode,200,url);
   assert.match(r.headers['content-security-policy'],/script-src 'self'/);
   assert.match(r.headers['content-security-policy'],/connect-src 'self'/);
 }
 assert.equal((await app.inject({method:'GET',url:'/jobs'})).statusCode,302);
 assert.equal((await app.inject({method:'GET',url:'/projects/'+pid+'?view=images'})).statusCode,302);
});
