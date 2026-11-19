import pg from 'pg';
import { LocalArtifactStore } from '../storage/artifact-store.js';
import { JobRepository } from './job-repository.js';
import { JobOrchestrator } from './orchestrator.js';
import {JobDispatcher} from './dispatcher.js';
import {ModalPythonExecutor} from './modal-executor.js';
import {ModalAccountManager} from '../modal/modal-accounts.js';
import {ModalCliTokenVerifier} from '../modal/modal-token-verifier.js';

const url=process.env.DATABASE_URL;
const root=process.env.ARTIFACT_ROOT;
const worker=process.env.MODAL_WORKER_ROOT;
if(!url||!root||!worker)throw new Error('DATABASE_URL, ARTIFACT_ROOT and MODAL_WORKER_ROOT are required');
const pool=new pg.Pool({connectionString:url,max:5,connectionTimeoutMillis:5000});
const jobs=new JobRepository(pool);
const key=process.env.MODAL_CREDENTIAL_ENCRYPTION_KEY;
const accounts=key?ModalAccountManager.fromBase64(pool,key,new ModalCliTokenVerifier()):undefined;
if(!accounts)throw new Error('Personal Modal credentials required');
const workflow=new JobOrchestrator(jobs,new LocalArtifactStore(root),
  new ModalPythonExecutor(worker,18*60_000,accounts));
const [command,owner,argument]=process.argv.slice(2);
if(command!=='dispatch' &&
  (!owner || (!argument&&!['modal-status','modal-test','modal-disconnect','modal-connect'].includes(command))))
  throw new Error('Usage: dispatch | run/recover OWNER JOB_ID | modal-connect/status/test/disconnect OWNER');

try {
  if(command==='dispatch'){
    if(!accounts)throw new Error('Dispatcher requires personal Modal accounts');
    const pollMs=Number(process.env.MODAL_DISPATCH_POLL_MS??'2000');
    const graceMinutes=Number(process.env.MODAL_STALE_JOB_MINUTES??'30');
    const dispatcher=new JobDispatcher(jobs,workflow,{pollMs,graceMinutes});
    const controller=new AbortController();
    process.once('SIGTERM',()=>controller.abort());
    process.once('SIGINT',()=>controller.abort());
    await dispatcher.run(controller.signal);
    } else if(command==='run'){
    const job=await workflow.execute(owner,argument);
    console.log(JSON.stringify({jobId:job.id,status:job.status}));
  } else if(command==='recover'){
    const job=await workflow.recover(owner,argument);
    console.log(JSON.stringify({jobId:job.id,status:job.status}));
  } else if(command==='modal-status'){
    if(!accounts)throw new Error('Modal account store not configured');
    console.log(JSON.stringify(await accounts.status(owner)));
  } else if(command==='modal-test'){
    if(!accounts)throw new Error('Modal account store not configured');
    await accounts.test(owner); console.log(JSON.stringify({status:'verified'}));
  } else if(command==='modal-disconnect'){
    if(!accounts)throw new Error('Modal account store not configured');
    await accounts.disconnect(owner); console.log(JSON.stringify({connected:false}));
  } else if(command==='modal-connect'){
    if(!accounts)throw new Error('Modal account store not configured');
    const {stdin}=process;
    // Read credentials only through stdin, never CLI arguments or logs.
    const parts:Buffer[]=[];let total=0;
    for await(const part of stdin){
      const chunk=Buffer.isBuffer(part)?part:Buffer.from(part);total+=chunk.length;
      if(total>4096)throw new Error('Credential input too large');
      parts.push(chunk);
    }
    const parsed=JSON.parse(Buffer.concat(parts).toString('utf8')) as {tokenId:string;tokenSecret:string};
    await accounts.saveAndTest(owner,parsed.tokenId,parsed.tokenSecret);
    console.log(JSON.stringify({connected:true}));
  } else throw new Error('Unknown command');
}finally{await pool.end();}
