import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePythonScript} from '../dist/jobs/python-script.js';

test('Python is the only strictly bounded modeling job type',()=>{
  const good=parsePythonScript({kind:'python_script',code:'import bpy\nbpy.ops.mesh.primitive_cube_add()'});
  assert.equal(good.kind,'python_script');
  for(const invalid of [
    {kind:'python_script',code:''},
    {kind:'python_script',code:'  '},
    {kind:'python_script',code:'print(1)\0'},
    {kind:'python_script',code:'x'.repeat(65537)},
    {kind:'python_script',code:'å'.repeat(33000)},
    {kind:'python_script',code:'print(1)',file:'/etc/passwd'},
    {kind:'python_script',code:23},
    {kind:'batch',operations:[{kind:'python_script',code:'print(1)'}]},
    {kind:'add_primitive',name:'Unsupported',primitive:'cube'}
  ])assert.throws(()=>parsePythonScript(invalid));
});
