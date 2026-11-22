import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PythonScriptSchema} from '../dist/jobs/python-script.js';
import {inspectSavedPerformance} from '../dist/scene/scene-contract.js';
import {projectIndexPage,projectDetailPage} from '../dist/web/project-pages.js';

test('DEV-045 explicitly opt-in render option is never implied',()=>{
  const script={kind:'python_script',code:'import bpy'};
  assert.equal(PythonScriptSchema.parse(script).inlineRender,undefined);
  assert.equal(PythonScriptSchema.parse({...script,inlineRender:true}).inlineRender,true);
  assert.throws(()=>PythonScriptSchema.parse({...script,inlineRender:'yes'}));
});

test('DEV-045 exposes only bounded and verified performance and status',async()=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'bw-inline-perf-'));
  try{
    const filename=path.join(folder,'scene.json');
    const report={schema_version:1,scene:{objects:[]},
      timings:{modelingSeconds:1.1,blendSaveSeconds:.2,glbExportSeconds:2.4,inlineRenderSeconds:3.9},
      execution:{sandboxStartSeconds:2,blenderExecutionSeconds:6,artifactTransferSeconds:1,
        estimatedComputeUsd:.001,estimateNote:'Approximate elapsed compute, not a Modal invoice'},
      inlineRender:{format:'png',status:'available',engine:'CYCLES',width:512,height:512,samples:16,
        framing:'auto-stored-bounds'}};
    const store={verifiedArtifactPath:async()=>filename};
    await writeFile(filename,JSON.stringify(report));
    const output=await inspectSavedPerformance(store,'project',1);
    assert.equal(output.inlineRender.status,'available');
    assert.equal(output.execution.estimatedComputeUsd,.001);
    await writeFile(filename,JSON.stringify({...report,execution:{...report.execution,estimatedComputeUsd:'SECRET'}}));
    await assert.rejects(()=>inspectSavedPerformance(store,'project',1));
    await writeFile(filename,JSON.stringify({schema_version:1,scene:{objects:[]}}));
    assert.equal(await inspectSavedPerformance(store,'project',1),null);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('DEV-046 unified render image uses the same URL as every other render',()=>{
  const id='11111111-1111-4111-8111-111111111111';
  const renderId='22222222-2222-4222-8222-222222222222';
  const date=new Date('2026-11-22T09:00:00Z');
  const project={id,name:'Cat',description:'',current_revision:1,updated_at:date};
  const revision={revision:1,artifact_prefix:'x',note:'',created_at:date,glbAvailable:true};
  const render={id:renderId,source_revision:1,engine:'CYCLES',width:512,height:512,
    samples:16,status:'completed',created_at:date};
  const url='/renders/'+id+'/'+renderId+'.png';
  assert.ok(projectIndexPage([{project,revisions:[revision],renders:[render]}]).includes(url));
  assert.ok(projectDetailPage(project,[revision],undefined,undefined,[render],[],'images').includes(url));
});
