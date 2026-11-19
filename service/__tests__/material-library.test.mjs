import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseSceneOperation} from '../dist/jobs/scene-operation.js';
import {SceneReportSchema,materialCatalog} from '../dist/scene/scene-contract.js';

const create=JSON.parse(await readFile(new URL('../../tests/fixtures/dev032_material_create.json',import.meta.url),'utf8'));
const edit=JSON.parse(await readFile(new URL('../../tests/fixtures/dev032_material_edit.json',import.meta.url),'utf8'));

test('DEV-032 material library batches are typed and bounded',()=>{
  assert.deepEqual(parseSceneOperation(create),create);
  assert.deepEqual(parseSceneOperation(edit),edit);
  const material=create.operations[2];
  const assign=create.operations[3];
  for(const invalid of [
    {...material,materialName:'../unsafe'},
    {...material,roughness:-1},
    {...material,emissionStrength:Infinity},
    {...material,baseColor:[0.3,0.2,NaN]},
    {...material,textureUrl:'https://example.org/texture.png'},
    {...material,code:'print(1)'},
    {...assign,name:'../../escape'},
    {...assign,materialName:'unknown/material'},
    {...assign,objectId:'11111111-1111-4111-8111-111111111111'},
    {...assign,python:'x'}
  ])assert.throws(()=>parseSceneOperation(invalid));
});

test('DEV-032 catalog preserves reusable PBR factors and zero-Modal lookup',()=>{
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
