import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../dist/app.js';

const ORIGIN='https://blender-workspace.apphome.one';
const OWNER='oauth:'+'a'.repeat(64),OTHER='oauth:'+'b'.repeat(64),CSRF='render-csrf-token';
const PROJECT=randomUUID(),RENDER=randomUUID();
test('browser only queues render after explicit signed-owner, origin and CSRF checks',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'bw-render-http-'));
 const png=path.join(root,'test.png');
 await writeFile(png,Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,...Array(20).fill(0)]));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const google={
   settingsSession(cookie){return cookie==='session=owner'?{ownerKey:OWNER,csrf:CSRF}:
     cookie==='session=other'?{ownerKey:OTHER,csrf:CSRF}:undefined;},
   beginSettingsLogin(){return {status:302,body:'',headers:{location:'/settings/login'}};},
   metadata(){return {};},jwks:{keys:[]}
 };
 const projects={
   async get(owner,id){return owner===OWNER&&id===PROJECT
     ?{id:PROJECT,name:'Test',description:'',current_revision:1,updated_at:new Date()}:null;},
   async list(){return [];},async revisions(owner,id){return owner===OWNER&&id===PROJECT
     ?[{revision:1,note:'Model',created_at:new Date(),artifact_prefix:PROJECT+'/00000001'}]:[];}
 };
 let queued=0,renderReads=0;
 const service=createApp({authMode:'google',google:{},publicOrigin:ORIGIN,
   host:'127.0.0.1',port:3000,accessToken:''},
   {projects,jobs:{},modalAccounts:{async status(){return {connected:true,needsRenewal:false};}},
    renderJobs:{
      async reserve(owner,id,revision,options){
        assert.equal(owner,OWNER);assert.equal(id,PROJECT);assert.equal(revision,1);
        assert.deepEqual(options,{engine:'CYCLES',width:256,height:256,samples:8});
        queued++;return {id:RENDER,status:'pending'};
      },
      async list(){return [];},
      async get(owner,id){return owner===OWNER&&id===RENDER
        ?{id:RENDER,project_id:PROJECT,status:'completed',sha256:'a'.repeat(64),size_bytes:40}:null;}
    },
    renderedImages:{async verifiedPath(id,job,sha){renderReads++;
      assert.equal(id,PROJECT);assert.equal(job,RENDER);return png;}},
    artifacts:{async inspect(){return {artifacts:[{name:'scene.blend'}]};}}
   },{google});
 t.after(()=>service.close());
 const post=(overrides={},body={})=>service.inject({
   method:'POST',url:'/projects/'+PROJECT+'/renders',
   headers:{cookie:'session=owner',origin:ORIGIN,'content-type':'application/x-www-form-urlencoded',...overrides},
   payload:new URLSearchParams({csrf:CSRF,revision:'1',engine:'CYCLES',size:'256',samples:'8',...body}).toString()
 });
 assert.equal((await post({cookie:'session=other'})).statusCode,404);
 assert.equal((await post({cookie:'session=other',origin:'https://evil.invalid'})).statusCode,403);
 assert.equal((await post({cookie:''})).statusCode,401);
 assert.equal((await post({origin:'https://evil.invalid'})).statusCode,403);
 assert.equal((await post({origin:'null','sec-fetch-site':'cross-site'})).statusCode,403);
 assert.equal((await post({}, {csrf:'bad'})).statusCode,403);
 assert.equal((await post({}, {size:'9999'})).statusCode,303);
 assert.equal(queued,0);
 const ok=await post({origin:'null','sec-fetch-site':'same-origin'});
 assert.equal(ok.statusCode,303);
 assert.match(ok.headers.location,/render_queued/);
 assert.equal(queued,1);
 const url='/renders/'+PROJECT+'/'+RENDER+'.png';
 const plain=await service.inject({method:'GET',url});
 assert.equal(plain.statusCode,401,'embedded image and API fetches retain 401');
 const direct=await service.inject({method:'GET',url,
   headers:{'sec-fetch-dest':'document','sec-fetch-mode':'navigate'}});
 assert.equal(direct.statusCode,302,'direct image tabs should offer Google sign in');
 assert.equal(direct.headers.location,
   '/settings/login?next='+encodeURIComponent(url));
 const embedded=await service.inject({method:'GET',url,
   headers:{'sec-fetch-dest':'image'}});
 assert.equal(embedded.statusCode,401);
 assert.equal(renderReads,0);

 assert.equal((await service.inject({method:'GET',url,headers:{cookie:'session=other'}})).statusCode,404);
 assert.equal(renderReads,0);
 const image=await service.inject({method:'GET',url,headers:{cookie:'session=owner'}});
 assert.equal(image.statusCode,200);
 assert.match(image.headers['content-type'],/image\/png/);
 assert.equal(renderReads,1);
});
