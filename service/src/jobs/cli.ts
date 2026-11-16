import pg from 'pg';
import { LocalArtifactStore } from '../storage/artifact-store.js';
import { ProjectRepository } from '../db/projects.js';
import { JobRepository } from './job-repository.js';
import { JobOrchestrator } from './orchestrator.js';
import { ModalPythonExecutor } from './modal-executor.js';

const url=process.env.DATABASE_URL;
const root=process.env.ARTIFACT_ROOT;
const worker=process.env.MODAL_WORKER_ROOT;
if(!url||!root||!worker)throw new Error('DATABASE_URL, ARTIFACT_ROOT and MODAL_WORKER_ROOT are required');
const pool=new pg.Pool({connectionString:url,max:5,connectionTimeoutMillis:5000});
const projects=new ProjectRepository(pool);
const jobs=new JobRepository(pool);
const workflow=new JobOrchestrator(jobs,new LocalArtifactStore(root),new ModalPythonExecutor(worker));
const [command,owner,argument]=process.argv.slice(2);
if(!owner||!argument)throw new Error('Usage: create OWNER PROJECT_NAME | recover OWNER JOB_ID');
try {
  if(command==='create'){
    const project=await projects.create(owner,argument);
    const job=await workflow.createDemo(owner,project.id);
    console.log(JSON.stringify({projectId:project.id,jobId:job.id,status:job.status}));
  } else if(command==='recover'){
    const job=await workflow.recover(owner,argument);
    console.log(JSON.stringify({jobId:job.id,status:job.status}));
  } else throw new Error('Unknown command');
}finally{await pool.end();}
