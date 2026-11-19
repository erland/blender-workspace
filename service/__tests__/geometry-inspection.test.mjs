import test from 'node:test';
import assert from 'node:assert/strict';
import {geometrySnapshot,geometryValidation,SceneReportSchema}
  from '../dist/scene/scene-contract.js';

const id='11111111-1111-4111-8111-111111111111';
const checks={boundaryEdges:0,nonManifoldEdges:0,looseEdges:0,
  isolatedVertices:0,degenerateFaces:0};
const geometry={
  vertexCount:8,edgeCount:12,faceCount:6,triangleCount:12,
  uvLayerCount:0,modifiers:[],
  worldBounds:{min:[1,-1,-1],max:[3,1,1],dimensions:[2,2,2]},
  qualityChecks:checks,warnings:[]
};
const cube={name:'Cube',objectId:id,type:'MESH',materials:[],bones:[],geometry};
const report={schema_version:1,scene:{objects:[cube]}};

test('DEV-030 typed geometry counts and world bounds survive parsing',()=>{
  const scene=SceneReportSchema.parse(report).scene;
  const snapshot=geometrySnapshot(scene);
  assert.equal(snapshot.available,true);
  assert.equal(snapshot.meshCount,1);
  assert.deepEqual(snapshot.objects[0].geometry.worldBounds.dimensions,[2,2,2]);
  assert.equal(geometrySnapshot(scene,id).objects[0].objectId,id);
  assert.equal(geometryValidation(scene).status,'no_warnings');
  assert.deepEqual(geometryValidation(scene).findings,[]);
  assert.throws(()=>geometrySnapshot(scene,'22222222-2222-4222-8222-222222222222'),/not found/);
});

test('DEV-030 historic reports do not invent geometry measurements or pass validation',()=>{
  const old=SceneReportSchema.parse({schema_version:1,scene:{objects:[
    {name:'Old',type:'MESH',materials:[],bones:[]}
  ]}}).scene;
  assert.equal(geometrySnapshot(old).available,false);
  assert.equal(geometrySnapshot(old).objects.length,0);
  assert.equal(geometryValidation(old).status,'incomplete');
  assert.equal(geometryValidation(old).checkedMeshes,0);
  const onlyCamera=SceneReportSchema.parse({schema_version:1,scene:{objects:[
    {name:'Camera',type:'CAMERA',materials:[],bones:[]}
  ]}}).scene;
  assert.equal(geometrySnapshot(onlyCamera).available,false);
  assert.equal(geometryValidation(onlyCamera).status,'incomplete');
});

test('DEV-030 diagnostic warnings and partial legacy coverage are explicit',()=>{
  const open={...cube,name:'Open Plane',objectId:'22222222-2222-4222-8222-222222222222',
    geometry:{...geometry,vertexCount:4,edgeCount:4,faceCount:1,triangleCount:2,
      qualityChecks:{...checks,boundaryEdges:4},
      warnings:[{code:'open_boundaries',count:4}]}};
  const scene=SceneReportSchema.parse({schema_version:1,scene:{objects:[
    open,{name:'Historic',type:'MESH'}
  ]}}).scene;
  const snapshot=geometrySnapshot(scene);
  assert.equal(snapshot.available,false);
  assert.equal(snapshot.partial,true);
  assert.equal(snapshot.meshesWithoutMetrics,1);
  const validation=geometryValidation(scene);
  assert.equal(validation.status,'incomplete');
  assert.equal(validation.findings[0].code,'open_boundaries');
  assert.equal(validation.findings[0].count,4);
  assert.equal(geometryValidation(scene,open.objectId).status,'warnings');
});

test('DEV-030 reject inconsistent, malicious or unbounded mesh metadata',()=>{
  for(const bad of [
    {...geometry,vertexCount:-1},
    {...geometry,worldBounds:{...geometry.worldBounds,max:[0,1,1]}},
    {...geometry,qualityChecks:{...checks,boundaryEdges:13}},
    {...geometry,warnings:[{code:'arbitrary_python',count:1}]},
    {...geometry,modifiers:[{name:'x',type:'modifier'}],uvLayerCount:Infinity},
  ]){
    assert.throws(()=>SceneReportSchema.parse({schema_version:1,scene:{objects:[
      {...cube,geometry:bad}
    ]}}));
  }
});
