import test from 'node:test';
import assert from 'node:assert/strict';
import {JobExecutionError,parseRunnerDiagnostic,safeStoredJobError,
 safeOwnerJobError,describeJobFailure} from '../dist/jobs/job-diagnostics.js';

test('DEV-042 preserves only safe line, type and process exit without user data',()=>{
 const input='Traceback /secret/path token=PRIVATE\n'+
   'BW_DIAGNOSTIC phase=blender_execution code=python_script_error exit=1 exception=AttributeError line=142\n';
 const parsed=parseRunnerDiagnostic(input);
 assert.ok(parsed instanceof JobExecutionError);
 assert.equal(parsed.code,'python_script_error');
 assert.equal(parsed.exitCode,1);
 assert.equal(parsed.sourceLine,142);
 assert.equal(parsed.exceptionType,'AttributeError');
 const stored=safeStoredJobError(parsed);
 assert.equal(stored,'BW_JOB_ERROR phase=blender_execution code=python_script_error exit=1 exception=AttributeError line=142');
 assert.equal(stored.includes('PRIVATE'),false);
 const owner=safeOwnerJobError(stored);
 assert.deepEqual(owner,{phase:'blender_execution',code:'python_script_error',exitCode:1,exceptionType:'AttributeError',sourceLine:142});
 assert.match(describeJobFailure(owner),/Python-fel.*AttributeError.*rad 142.*exit-kod 1/);
});

test('DEV-042 distinguish unknown crash, timeout and verified OOM; never infer from SIGKILL alone',()=>{
 for(const code of ['blender_crash','blender_timeout','out_of_memory']){
  const d=parseRunnerDiagnostic('BW_DIAGNOSTIC phase=blender_execution code='+code+' exit=137');
  assert.equal(d?.code,code);
  assert.equal(safeOwnerJobError(safeStoredJobError(d)).code,code);
 }
 assert.equal(describeJobFailure(safeOwnerJobError('BW_JOB_ERROR phase=blender_execution code=blender_crash exit=137')).includes('Minnesbrist'),false);
});

test('DEV-042 reject arbitrary sensitive diagnostics and never render unsafe legacy errors',()=>{
 const invalid=[
   'BW_JOB_ERROR phase=blender_execution code=python_script_error exception=PasswordError line=2',
   'BW_JOB_ERROR phase=blender_execution code=python_script_error exception=AttributeError line=0',
   'BW_JOB_ERROR phase=blender_execution code=blender_crash exit=99999999',
   'BW_JOB_ERROR phase=blender_execution code=out_of_memory exception=AttributeError line=7',
   'my internal token=SECRET'
 ];
 for(const row of invalid)assert.equal(safeOwnerJobError(row),null);
 assert.equal(parseRunnerDiagnostic('BW_DIAGNOSTIC phase=blender_execution code=python_script_error exception=PasswordError line=7')?.exceptionType,undefined);
 assert.equal(describeJobFailure(safeOwnerJobError('Password=PRIVATE')),null);
});
