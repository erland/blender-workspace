import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SceneReportSchema,inspectSavedScene,inspectSavedPerformance,geometryValidation} from '../dist/scene/scene-contract.js';
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


test('large checksum-verified architectural scene reports remain inspectable and validatable',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-large-scenes-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const storage=new LocalArtifactStore(root);
  const projectId=randomUUID();
  const scenePath=path.join(root,'large-scene.json');
  const blendPath=path.join(root,'large-scene.blend');
  const checks={boundaryEdges:0,nonManifoldEdges:0,looseEdges:0,
    isolatedVertices:0,degenerateFaces:0};
  const mesh={vertexCount:8,edgeCount:12,faceCount:6,triangleCount:12,
    uvLayerCount:0,modifiers:[],
    worldBounds:{min:[0,0,0],max:[1,1,1],dimensions:[1,1,1]},
    qualityChecks:checks,warnings:[]};
  const report={schema_version:1,
    timings:{modelingSeconds:10,blendSaveSeconds:1,glbExportSeconds:1},
    scene:{objects:Array.from({length:5000},(_,i)=>({
      name:'Architectural element '+i.toString().padStart(5,'0'),
      objectId:`00000000-0000-4000-8000-${i.toString(16).padStart(12,'0')}`,
      type:'MESH',geometry:mesh,materials:['Limestone facade'],bones:[],
      localTransform:{location:[i/100,0,0],rotationEuler:[0,0,0],scale:[1,1,1]}
    }))}};
  const data=JSON.stringify(report);
  assert.ok(Buffer.byteLength(data)>2*1024*1024,'fixture must reproduce the old 2 MiB limit');
  await writeFile(scenePath,data);await writeFile(blendPath,'model');
  await storage.publish({projectId,revision:1,expectedPreviousRevision:0,artifacts:[
    {name:'scene.json',sourcePath:scenePath},{name:'scene.blend',sourcePath:blendPath}
  ]});
  const inspected=await inspectSavedScene(storage,projectId,1);
  assert.equal(inspected.objects.length,5000);
  assert.equal(geometryValidation(inspected).status,'no_warnings');
  assert.equal(geometryValidation(inspected).checkedMeshes,5000);
  assert.equal((await inspectSavedPerformance(storage,projectId,1)).timings.modelingSeconds,10);
  // SHA checking must remain in force even for oversized reports.
  const saved=await storage.verifiedArtifactPath(projectId,1,'scene.json');
  await writeFile(saved,data.replace('Architectural element 00000','Tampered architectural object'));
  await assert.rejects(()=>inspectSavedScene(storage,projectId,1),/checksum mismatch/i);
});

test('unbounded scene reports are rejected before JSON parsing',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-huge-scenes-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const storage=new LocalArtifactStore(root);
  const projectId=randomUUID();
  const source=path.join(root,'huge.json');
  const blend=path.join(root,'tiny.blend');
  await writeFile(source,Buffer.alloc(32*1024*1024+1,32));
  await writeFile(blend,'model');
  await storage.publish({projectId,revision:1,expectedPreviousRevision:0,artifacts:[
    {name:'scene.json',sourcePath:source},{name:'scene.blend',sourcePath:blend}
  ]});
  await assert.rejects(()=>inspectSavedScene(storage,projectId,1),/too large/);
  await assert.rejects(()=>inspectSavedPerformance(storage,projectId,1),/too large/);
});
