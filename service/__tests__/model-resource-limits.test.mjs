import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parsePythonScript} from '../dist/jobs/python-script.js';
import {preflightPython} from '../dist/jobs/python-preflight.js';

test('MODEL-001 accepts Python up to 64 KiB and rejects larger source',async()=>{
  const valid='pass\n'+'#'.repeat(65_536-5);
  assert.equal(Buffer.byteLength(valid),65_536);
  assert.equal(parsePythonScript({kind:'python_script',code:valid}).code.length,65_536);
  await preflightPython(valid);
  assert.throws(()=>parsePythonScript({kind:'python_script',code:valid+'x'}));
});

test('MODEL-001 no old mesh/object/topology quotas in Blender sandbox',async()=>{
  const src=await readFile(new URL('../../blender_workspace_poc/apply_python.py',import.meta.url),'utf8');
  for(const old of ['2_000_000','1_000_000','len(objects)>512','len(meshes)>256']){
    assert.ok(!src.includes(old),old);
  }
  assert.ok(src.includes('Scene must contain at least one object'));
});
