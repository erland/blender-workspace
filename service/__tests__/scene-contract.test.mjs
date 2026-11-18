import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SceneReportSchema,inspectSavedScene} from '../dist/scene/scene-contract.js';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';

test('generic scene parser retains arbitrary object names and materials, without monster assumptions',()=>{
  const source={schema_version:1,stage:'created',scene:{
    blender_version:'4.5',fps:24,frame_start:1,frame_end:90,
    objects:[{name:'Architectural / Spiral Staircase',type:'MESH',
      materials:['Brushed stainless steel'],bones:[],
      parent:'Floor 2',localTransform:{location:[1,2,3],rotationEuler:[0,0,1.2],scale:[1,1,1]}},
      {name:'Floor 2',type:'EMPTY',parent:null,materials:[],bones:[]},
      {name:'Sun',type:'LIGHT',materials:[],bones:[]}],
    actions:[],render_engine:'BLENDER_EEVEE_NEXT'}};
  const parsed=SceneReportSchema.parse(source);
  assert.equal(parsed.scene.objects[0].name,'Architectural / Spiral Staircase');
  assert.equal(parsed.scene.objects[1].type,'EMPTY');
  assert.equal(parsed.scene.objects[2].type,'LIGHT');
  assert.deepEqual(parsed.scene.objects[0].localTransform.location,[1,2,3]);
  assert.throws(()=>SceneReportSchema.parse({schema_version:1,scene:{objects:[
    {name:'Broken',type:'MESH',localTransform:{location:[NaN,0,0],rotationEuler:[0,0,0],scale:[1,1,1]}}
  ]}}));
});
test('DEV-022 scene reports accept legacy names and reject duplicated object IDs',()=>{
  const stable='11111111-1111-4111-8111-111111111111';
  const report={schema_version:1,scene:{objects:[
    {name:'Before rename',type:'MESH',objectId:stable,materials:[],bones:[]},
    {name:'Legacy object',type:'MESH',materials:[],bones:[]}
  ]}};
  assert.equal(SceneReportSchema.parse(report).scene.objects[0].objectId,stable);
  assert.equal(SceneReportSchema.parse(report).scene.objects[1].objectId,undefined);
  assert.throws(()=>SceneReportSchema.parse({...report,scene:{objects:[
    {...report.scene.objects[0],objectId:'not-a-uuid'}
  ]}}));
});
test('scene catalog reads only validated, SHA-verified revision artifacts',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-scenes-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const storage=new LocalArtifactStore(root);
  const projectId=randomUUID();
  const sample=path.join(root,'geometry.json');
  const mesh=path.join(root,'scene.blend');
  const report={schema_version:1,stage:'created',scene:{objects:[
    {name:'Office Chair',type:'MESH',materials:['Blue fabric'],bones:[]},
    {name:'Studio Camera',type:'CAMERA',materials:[],bones:[]}
  ]}};
  await writeFile(sample,JSON.stringify(report));
  await writeFile(mesh,'simulated Blender bytes');
  await storage.publish({projectId,revision:1,expectedPreviousRevision:0,artifacts:[
    {name:'arbitrary_scene.json',sourcePath:sample},{name:'scene.blend',sourcePath:mesh}
  ]});
  const scene=await inspectSavedScene(storage,projectId,1);
  assert.deepEqual(scene.objects.map(x=>x.name),['Office Chair','Studio Camera']);
  assert.equal(scene.objects[1].type,'CAMERA');
  const filepath=await storage.verifiedArtifactPath(projectId,1,'arbitrary_scene.json');
  await writeFile(filepath,'{"schema_version":1,"scene":{"objects":[]}}');
  await assert.rejects(()=>inspectSavedScene(storage,projectId,1),/checksum mismatch/i);
});
