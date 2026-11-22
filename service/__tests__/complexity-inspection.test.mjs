import test from 'node:test';
import assert from 'node:assert/strict';
import {SceneReportSchema,geometrySnapshot} from '../dist/scene/scene-contract.js';

const id='11111111-1111-4111-8111-111111111111';
const mesh={source:'stored',evaluated:false,proceduralPotential:true,
  modifiers:[{name:'Nodes',type:'NODES',procedural:true}],
  mesh:{vertices:8,edges:12,faces:6}};
const hair={source:'stored',evaluated:false,proceduralPotential:false,
  modifiers:[],hair:{curveCount:512,pointCount:1024,interpolatedCount:null}};
const report=objects=>({schema_version:1,scene:{objects}});

test('DEV-044 retained stored hair, modifier and mesh diagnostics',()=>{
  const scene=SceneReportSchema.parse(report([
    {name:'Fur',objectId:id,type:'CURVES',complexity:hair},
    {name:'Carrier',type:'MESH',complexity:mesh}
  ])).scene;
  const result=geometrySnapshot(scene);
  assert.equal(result.complexity.available,true);
  assert.equal(result.complexity.objects[0].complexity.hair.curveCount,512);
  assert.equal(result.complexity.objects[0].complexity.hair.interpolatedCount,null);
  assert.equal(result.complexity.objects[1].complexity.proceduralPotential,true);
  assert.equal(geometrySnapshot(scene,id).complexity.objects.length,1);
  assert.equal(result.available,false); // no legacy mesh quality metrics supplied
});

test('DEV-044 historical and mixed reports never invent stored complexity',()=>{
  const old=SceneReportSchema.parse(report([{name:'Old hair',type:'CURVES'}])).scene;
  assert.equal(geometrySnapshot(old).complexity.available,false);
  assert.equal(geometrySnapshot(old).complexity.partial,false);
  const mixed=SceneReportSchema.parse(report([
    {name:'Hair',type:'CURVES',complexity:hair},
    {name:'Old mesh',type:'MESH'}
  ])).scene;
  assert.equal(geometrySnapshot(mixed).complexity.partial,true);
  assert.equal(geometrySnapshot(mixed).complexity.objectsWithoutMetrics,1);
});

test('DEV-044 rejects forged/unbounded complexity measurements',()=>{
  const invalid=[
    {...hair,evaluated:true},
    {...hair,source:'evaluated'},
    {...hair,proceduralPotential:true},
    {...hair,hair:{...hair.hair,interpolatedCount:20000}},
    {...hair,hair:{...hair.hair,curveCount:-1}},
    {...hair,modifiers:Array.from({length:65},()=>({name:'X',type:'NODES',procedural:false}))},
    {...hair,secret:'exfiltrate'}
  ];
  for(const complexity of invalid)
    assert.throws(()=>SceneReportSchema.parse(report([{name:'Hair',type:'CURVES',complexity}])));
});
