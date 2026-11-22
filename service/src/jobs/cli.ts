import pg from 'pg';
import {databasePoolConfig} from '../db/pool-config.js';
import { LocalArtifactStore } from '../storage/artifact-store.js';
import { JobRepository } from './job-repository.js';
import { JobOrchestrator } from './orchestrator.js';
import {JobDispatcher} from './dispatcher.js';
import {ModalPythonExecutor} from './modal-executor.js';
import {ModalRenderExecutor} from './modal-render.js';
import {RenderJobRepository} from './render-repository.js';
import {RenderArtifactStore} from '../storage/render-artifacts.js';
import {RenderOrchestrator} from './render-orchestrator.js';
import {GlbPreviewRepository} from './glb-preview-repository.js';
import {GlbPreviewArtifactStore} from '../storage/glb-preview-artifacts.js';
import {GlbPreviewOrchestrator} from './glb-preview-orchestrator.js';
import {ModalGlbPreviewExecutor} from './modal-glb-preview.js';
import {UploadedAssetStore} from '../storage/uploaded-assets.js';
import {UploadedAssets} from './uploaded-assets.js';
import {ModalAccountManager} from '../modal/modal-accounts.js';
import {ModalCliTokenVerifier} from '../modal/modal-token-verifier.js';

const connection=databasePoolConfig();
const root=process.env.ARTIFACT_ROOT;
const worker=process.env.MODAL_WORKER_ROOT;
if(!connection||!root||!worker)
  throw new Error('PostgreSQL connection, ARTIFACT_ROOT and MODAL_WORKER_ROOT are required');
const pool=new pg.Pool(connection);
const jobs=new JobRepository(pool);
const key=process.env.MODAL_CREDENTIAL_ENCRYPTION_KEY;
const accounts=key?ModalAccountManager.fromBase64(pool,key,new ModalCliTokenVerifier()):undefined;
if(!accounts)throw new Error('Personal Modal credentials required');
const uploads=new UploadedAssets(pool,new UploadedAssetStore(root));
const renderQueue=new RenderJobRepository(pool);
const renderFiles=new RenderArtifactStore(root);
const workflow=new JobOrchestrator(jobs,new LocalArtifactStore(root),
  new ModalPythonExecutor(worker,18*60_000,accounts),uploads,renderQueue,renderFiles);
const renderWorkflow=new RenderOrchestrator(renderQueue,new LocalArtifactStore(root),
  renderFiles,new ModalRenderExecutor(worker,accounts));
const previewQueue=new GlbPreviewRepository(pool);
const previewWorkflow=new GlbPreviewOrchestrator(previewQueue,new LocalArtifactStore(root),
  new GlbPreviewArtifactStore(root),new ModalGlbPreviewExecutor(worker,accounts));
const [command,owner,argument]=process.argv.slice(2);
if(command!=='dispatch' &&
  (!owner || (!argument&&!['modal-status','modal-test','modal-disconnect','modal-connect'].includes(command))))
  throw new Error('Usage: dispatch | run/recover OWNER JOB_ID | modal-connect/status/test/disconnect OWNER');

try {
  if(command==='dispatch'){
    if(!accounts)throw new Error('Dispatcher requires personal Modal accounts');
    const pollMs=Number(process.env.MODAL_DISPATCH_POLL_MS??'2000');
    const graceMinutes=Number(process.env.MODAL_STALE_JOB_MINUTES??'30');
    const dispatcher=new JobDispatcher(jobs,workflow,{pollMs,graceMinutes},renderQueue,renderWorkflow,
      previewQueue,previewWorkflow);
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
  } else if(command==='inline-render-recover'){
    const job=await jobs.get(owner,argument);
    if(!job||job.status!=='completed')throw new Error('Completed model job not found');
    console.log(JSON.stringify({registered:await workflow.registerSavedInlineRender(job)}));
  } else if(command==='render-recover'){
    console.log(JSON.stringify({recovered:await renderWorkflow.recover(owner,argument)}));
  } else if(command==='preview-recover'){
    console.log(JSON.stringify({recovered:await previewWorkflow.recover(owner,argument)}));
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
