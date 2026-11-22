import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {modelImportPage} from '../dist/web/project-pages.js';
import {modelUploadScript} from '../dist/web/model-upload-client.js';

function browserHarness(){
 const handlers=new Map(),status={textContent:''},button={disabled:false};
 const fileInput={files:[],addEventListener(type,cb){handlers.set('file:'+type,cb);}};
 const form={addEventListener(type,cb){handlers.set('form:'+type,cb);},
  querySelector(selector){return selector==='button'?button:{value:'test-csrf'};}};
 let uploads=0;
 const context={document:{getElementById(id){
   return {'upload-model-form':form,'model-file':fileInput,
     'model-upload-result':status}[id];}},
   fetch:async()=>{uploads++;return {ok:true,json:async()=>({uploadId:'test-id'})};},
   window:{location:{assign(){}}}};
 vm.runInNewContext(modelUploadScript,context,{timeout:500});
 return {handlers,fileInput,status,button,get uploads(){return uploads;}};
}

test('Safari/iPad import uses unrestricted native file picker and explains allowed formats',()=>{
 const html=modelImportPage('csrf',[],[]);
 assert.match(html,/<input id="model-file"[^>]*type="file"/);
 assert.doesNotMatch(html,/<input id="model-file"[^>]*accept=/,
   'iOS WebKit can prevent uncommon .blend/.glb types from being selectable');
 assert.match(html,/model-file-help/);
 assert.match(html,/Välj en .blend- eller .glb-fil/);
});

test('upload client shows file selection and rejects wrong extension before network',async()=>{
 const h=browserHarness();
 h.fileInput.files=[{name:'archive.zip',size:200}];
 h.handlers.get('file:change')();
 assert.equal(h.status.textContent,'Vald fil: archive.zip');
 let prevented=false;
 await h.handlers.get('form:submit')({preventDefault(){prevented=true;}});
 assert.equal(prevented,true);
 assert.match(h.status.textContent,/ändelsen .blend eller .glb/);
 assert.equal(h.uploads,0);
 assert.equal(h.button.disabled,false);
 h.fileInput.files=[{name:'scene.blend',size:10}];
 await h.handlers.get('form:submit')({preventDefault(){}});
 assert.match(h.status.textContent,/20 byte/);
 assert.equal(h.uploads,0);
 h.fileInput.files=[];
 h.handlers.get('file:change')();
 assert.equal(h.status.textContent,'Ingen fil vald.');
});

test('upload client accepts correct uppercase BLEND and GLB extensions',async()=>{
 for(const name of ['scene.blend','SCENE.BLEND','scene.glb','SCENE.GLB']){
  const h=browserHarness();
  h.fileInput.files=[{name,size:1024}];
  await h.handlers.get('form:submit')({preventDefault(){}});
  assert.equal(h.uploads,1,name);
 }
});
