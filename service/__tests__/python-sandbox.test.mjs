import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePythonScript} from '../dist/jobs/python-script.js';
import {parseSceneOperation} from '../dist/jobs/scene-operation.js';

test('Python source is a separate, strictly bounded job type',()=>{
  const good=parsePythonScript({kind:'python_script',code:'import bpy\nbpy.ops.mesh.primitive_cube_add()'});
  assert.equal(good.kind,'python_script');
  for(const invalid of [
    {kind:'python_script',code:''},
    {kind:'python_script',code:'  '},
    {kind:'python_script',code:'print(1)\0'},
    {kind:'python_script',code:'x'.repeat(16385)},
    {kind:'python_script',code:'print(1)',file:'/etc/passwd'},
    {kind:'python_script',code:23},
    {kind:'batch',operations:[{kind:'python_script',code:'print(1)'}]}
  ])assert.throws(()=>parsePythonScript(invalid));
  assert.throws(()=>parseSceneOperation(good),
    'sandbox Python must not pass through bounded scene operation API');
});
