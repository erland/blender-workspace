import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ModalPythonExecutor} from '../dist/jobs/modal-executor.js';
import {JobExecutionError,parseRunnerDiagnostic,safeStoredJobError,
  safeOwnerJobError} from '../dist/jobs/job-diagnostics.js';

const SECRET='super-secret-modal-value-DO-NOT-EXPOSE';
test('only finite phase/code diagnostics survive, never raw provider text',()=>{
  const sample='Exception: '+SECRET+' /sensitive/path\n'+
    'BW_DIAGNOSTIC phase=modal_start code=image_unavailable\n';
  const parsed=parseRunnerDiagnostic(sample);
  assert.equal(parsed?.message,'BW_JOB_ERROR phase=modal_start code=image_unavailable');
  assert.equal(safeStoredJobError(parsed),parsed.message);
  assert.deepEqual(safeOwnerJobError(parsed.message),
    {phase:'modal_start',code:'image_unavailable'});
  assert.equal(safeStoredJobError(new Error(SECRET)),
    'BW_JOB_ERROR phase=setup code=initialization_failed');
  assert.equal(safeOwnerJobError('Error: '+SECRET),null);
  assert.equal(parseRunnerDiagnostic('BW_DIAGNOSTIC phase=modal_start code='+SECRET),null);
  assert.equal(safeOwnerJobError('BW_JOB_ERROR phase=setup code='+SECRET),null);
});

test('bounded subprocess diagnostics ignore secret-bearing stderr/stdout',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-diagnostic-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'modal_provider'));
  const py=[
    'import sys',
    "sys.stderr.write('secret '+ "+JSON.stringify(SECRET)+" +'\\n')",
    "sys.stdout.write('token '+ "+JSON.stringify(SECRET)+" +'\\n')",
    "sys.stderr.write('BW_DIAGNOSTIC phase=blender_execution code=blender_execution_failed\\n')",
    'sys.exit(1)'
  ].join('\n');
  await writeFile(path.join(root,'modal_provider','runner.py'),py);
  const executor=new ModalPythonExecutor(root,30000,{
    async requireConnected(){return {tokenId:'test-id',tokenSecret:SECRET};}
  });
  let failure;
  try{
    await executor.runPythonScript(path.join(root,'out'),'owner',1,
      {kind:'python_script',code:'import bpy\nbpy.ops.mesh.primitive_cube_add()'});
  }catch(error){failure=error;}
  assert.ok(failure instanceof JobExecutionError);
  assert.deepEqual(safeOwnerJobError(safeStoredJobError(failure)),
    {phase:'blender_execution',code:'blender_execution_failed'});
  assert.ok(!String(failure).includes(SECRET));
});

test('unexpected process failure reveals no output to caller or persistence',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-diagnostic-negative-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'modal_provider'));
  await writeFile(path.join(root,'modal_provider','runner.py'),
    "import sys\nsys.stderr.write("+JSON.stringify(SECRET)+")\nsys.exit(1)\n");
  const executor=new ModalPythonExecutor(root,30000,{
    async requireConnected(){return {tokenId:'id',tokenSecret:SECRET};}
  });
  await assert.rejects(
    ()=>executor.runPythonScript(path.join(root,'out'),'owner',1,
      {kind:'python_script',code:'print(1)'}),
    error=>error instanceof JobExecutionError&&error.code==='worker_exit_nonzero'&&
      !String(error).includes(SECRET));
});
