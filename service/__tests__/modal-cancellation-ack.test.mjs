import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ModalPythonExecutor} from '../dist/jobs/modal-executor.js';

const accounts={
  async requireConnected(){return {tokenId:'fake-test-only',tokenSecret:'fake-test-only'};},
  async memoryMiB(){return 8192;}
};

async function simulatedController(t,acknowledge){
  const root=await mkdtemp(path.join(os.tmpdir(),'bw-cancel-ack-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'modal_provider'));
  // No Modal SDK and no Blender execution. This is a local process simulating
  // the controller's trusted termination marker and lifecycle phases.
  await writeFile(path.join(root,'modal_provider','runner.py'),`
import signal,sys,time
def terminate(_signum,_frame):
    time.sleep(0.05)
    ${acknowledge ? "sys.stderr.write('BW_CANCELLED\\\\r\\\\n')" : "sys.stderr.write('BW_DIAGNOSTIC phase=cleanup code=sandbox_cleanup_failed\\\\n')"}
    sys.stderr.flush()
    raise SystemExit(2)
signal.signal(signal.SIGTERM,terminate)
sys.stdout.write('BW_PROGRESS phase=modal_start\\\\n')
sys.stdout.flush()
while True:
    time.sleep(0.1)
`);
  const signal=new AbortController();
  const executor=new ModalPythonExecutor(root,20_000,accounts);
  const run=executor.runPythonScript(path.join(root,'out'),'owner',1,
    {kind:'python_script',code:'import bpy'},undefined,[],[],
    async phase=>{if(phase==='modal_start')signal.abort();},signal.signal);
  return run;
}

test('Cancellation acknowledgement from a real subprocess is recognized (CRLF)',async t=>{
  await assert.rejects(simulatedController(t,true),
    error=>error?.name==='JobCancelledConfirmed');
});
test('No cleanup acknowledgement must never be reported as cancelled',async t=>{
  await assert.rejects(simulatedController(t,false),
    error=>error?.name==='JobCancellationUnconfirmed');
});
