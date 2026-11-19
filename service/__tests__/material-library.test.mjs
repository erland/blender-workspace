import test from 'node:test';
import assert from 'node:assert/strict';
import {SceneReportSchema,materialCatalog} from '../dist/scene/scene-contract.js';

test('PBR material catalog preserves reusable material factors and requires no Modal',()=>{
  const material={name:'Brushed Aluminium',baseColor:[0.35,0.45,0.6],
    metallic:0.9,roughness:0.3,opacity:1,emissionColor:[0,0,0],
    emissionStrength:0,usedBy:['Desk','Leg']};
  const scene=SceneReportSchema.parse({schema_version:1,scene:{
    objects:[{name:'Desk',type:'MESH',materials:['Brushed Aluminium']}],
    materialLibrary:[material]
  }}).scene;
  assert.equal(materialCatalog(scene).available,true);
  assert.equal(materialCatalog(scene).materials[0].usedBy.length,2);
  const historic=SceneReportSchema.parse({schema_version:1,scene:{objects:[]}}).scene;
  assert.equal(materialCatalog(historic).available,false);
  assert.deepEqual(materialCatalog(historic).materials,[]);
  assert.throws(()=>materialCatalog(SceneReportSchema.parse({schema_version:1,scene:{
    objects:[],materialLibrary:[material,material]
  }}).scene),/Duplicate/);
  for(const bad of [
    {...material,opacity:2},
    {...material,usedBy:['/etc/passwd'],metallic:NaN},
    {...material,script:'evil'},
  ])assert.throws(()=>SceneReportSchema.parse({schema_version:1,scene:{
    objects:[],materialLibrary:[bad]
  }}));
});
