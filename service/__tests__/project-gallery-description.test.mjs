import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/app.js';

const ORIGIN='https://blender-workspace.apphome.one';
const PROJECT=randomUUID(),RENDER1=randomUUID(),RENDER2=randomUUID(),RENDER3=randomUUID();
const OWNER='oauth:'+'a'.repeat(64),OTHER='oauth:'+'b'.repeat(64),CSRF='gallery-csrf';

function setup(t){
 let description='Original <description>',updates=0,listRequests=0;
 const project=()=>({id:PROJECT,name:'Projekt & bilder',description,
   current_revision:1,updated_at:new Date()});
 const google={
   settingsSession(cookie){return cookie==='session=owner'?{ownerKey:OWNER,csrf:CSRF}:
     cookie==='session=other'?{ownerKey:OTHER,csrf:CSRF}:undefined;},
   beginSettingsLogin(){return {status:302,body:'',headers:{location:'/settings/login'}};},
   metadata(){return {};},jwks:{keys:[]}
 };
 const renders=[RENDER1,RENDER2,RENDER3].map((id,i)=>({
   id,project_id:PROJECT,source_revision:1,status:'completed',
   requested_from:i%2?'viewer':'project',engine:'CYCLES',width:256,height:256,
   samples:16,created_at:new Date()
 }));
 const app=createApp({authMode:'google',google:{},publicOrigin:ORIGIN,host:'127.0.0.1',
   port:3000,accessToken:''},{
   projects:{
     async get(owner,id){return owner===OWNER&&id===PROJECT?project():null;},
     async list(owner){return owner===OWNER?[project()]:[];},
     async revisions(owner,id){return owner===OWNER&&id===PROJECT
       ?[{revision:1,artifact_prefix:PROJECT+'/00000001',note:'',
          created_at:new Date()}]:[];},
     async updateDescription(owner,id,value){
       if(owner!==OWNER||id!==PROJECT)return null;
       updates++;description=value;return project();
     }
   },
   jobs:{async list(){return [];}},
   renderJobs:{
     async recentCompletedByProjects(owner,ids,n){
       listRequests++;
       assert.equal(n,3);
       assert.deepEqual(ids,owner===OWNER?[PROJECT]:[]);
       return owner===OWNER?renders:[];
     },
     async list(owner,id){return owner===OWNER&&id===PROJECT?renders:[];}
   },
   modalAccounts:{async status(){return {connected:false,needsRenewal:false};}},
   artifacts:{async inspect(){return {artifacts:[{name:'scene.blend'},{name:'scene.glb'}]};}}
 },{google});
 t.after(()=>app.close());
 return {app,updates:()=>updates,listRequests:()=>listRequests};
}

test('project and index PNG thumbnails are allowed by CSP and use shared signed URLs',async t=>{
 const {app,listRequests}=setup(t);
 const get=(url,cookie='session=owner')=>app.inject({method:'GET',url,headers:{cookie}});
 const home=await get('/');
 assert.equal(home.statusCode,200);
 assert.match(home.headers['content-security-policy'],/img-src 'self'/);
 for(const id of [RENDER1,RENDER2,RENDER3])
   assert.match(home.body,new RegExp('/renders/'+PROJECT+'/'+id+'\\.png'));
 assert.equal((home.body.match(/class="project-thumbnails"/g)||[]).length,1);
 assert.equal((home.body.match(/loading="lazy"/g)||[]).length,3);
 assert.equal(listRequests(),1);
 const detail=await get('/projects/'+PROJECT);
 assert.equal(detail.statusCode,200);
 assert.match(detail.headers['content-security-policy'],/img-src 'self'/);
 assert.match(detail.body,/Renderingsjobb och bilder/);
 assert.match(detail.body,/Spara beskrivning/);
 assert.match(detail.body,/Original &lt;description&gt;/);
 const foreign=await get('/','session=other');
 assert.doesNotMatch(foreign.body,/Projekt &amp; bilder|class="project-thumbnails"/);
 assert.equal((await get('/projects/'+PROJECT,'session=other')).statusCode,404);
});

test('description edit is owner-only, csrf and origin checked, bounded, escaped, and clearable',async t=>{
 const {app,updates}=setup(t);
 const url='/projects/'+PROJECT+'/description';
 const post=(value,cookie='session=owner',origin=ORIGIN,csrf=CSRF)=>app.inject({
   method:'POST',url,headers:{cookie,origin,'content-type':'application/x-www-form-urlencoded'},
   payload:new URLSearchParams({csrf,description:value}).toString()
 });
 assert.equal((await post('hacked','session=other')).statusCode,404);
 assert.equal((await post('hacked','session=invalid')).statusCode,401);
 assert.equal((await post('hacked','session=owner','https://evil.example')).statusCode,403);
 assert.equal((await post('hacked','session=owner',ORIGIN,'bad')).statusCode,403);
 const tooLong=await post('x'.repeat(5001));
 assert.equal(tooLong.statusCode,303);
 assert.match(tooLong.headers.location,/description_invalid/);
 assert.equal(updates(),0);
 const saved=await post('<script>alert(1)</script>');
 assert.equal(saved.statusCode,303);
 assert.match(saved.headers.location,/description_updated/);
 assert.equal(updates(),1);
 const detail=await app.inject({method:'GET',url:'/projects/'+PROJECT,
   headers:{cookie:'session=owner'}});
 assert.match(detail.body,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
 assert.doesNotMatch(detail.body,/<script>alert/);
 assert.equal((await post('')).statusCode,303);
 assert.equal(updates(),2);
});
