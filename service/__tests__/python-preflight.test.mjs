import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {preflightPython,PythonSyntaxError} from '../dist/jobs/python-preflight.js';
import {JobRepository} from '../dist/jobs/job-repository.js';

test('preflight accepts valid arbitrary bpy source without Blender installed',async()=>{
  await preflightPython('import bpy\nbpy.ops.mesh.primitive_cube_add()');
  await preflightPython('def build():\n    return 3\n');
});

test('syntax and indentation errors expose location without echoing source',async()=>{
  for(const [source,line] of [
    ['import bpy\nfor i in range(3)\n    print(i)',2],
    ['if True:\nprint(1)',2],
    ['def broken(:\n    pass',1]
  ]){
    await assert.rejects(()=>preflightPython(source),error=>{
      assert.ok(error instanceof PythonSyntaxError);
      assert.equal(error.line,line);
      assert.match(error.message,/Python syntax error at line/);
      assert.ok(Number.isInteger(error.column));
      assert.ok(!error.message.includes('import bpy'));
      return true;
    });
  }
});

test('preflight compiles but does not execute incoming instructions',async()=>{
  // The following side effects would fail or write if user code were executed.
  await preflightPython("raise RuntimeError('SCRIPT WAS EXECUTED')");
  await preflightPython("import os\nos._exit(88)");
  await preflightPython("open('/tmp/preflight-must-not-run','w').write('bad')");
});

test('missing interpreter rejects closed, with no fallback to Modal',async()=>{
  await assert.rejects(
    ()=>preflightPython('print(1)','/nonexistent/blender-python-'+randomUUID()),
    /syntax preflight is unavailable/
  );
});

test('job repository never connects to PostgreSQL for invalid syntax',async()=>{
  let connections=0;
  const repo=new JobRepository({async connect(){connections++;throw Error('should not connect');}});
  await assert.rejects(
    ()=>repo.reserve('owner',randomUUID(),0,'syntax check',undefined,
      {kind:'python_script',code:'for thing in []\n    pass'}),
    error=>error instanceof PythonSyntaxError
  );
  assert.equal(connections,0);
});
