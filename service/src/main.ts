import pg from 'pg';
import {databasePoolConfig} from './db/pool-config.js';
import {createApp} from './app.js';
import {loadConfig} from './config.js';
import {ProjectRepository} from './db/projects.js';
import {JobRepository} from './jobs/job-repository.js';
import {GoogleOAuthServer} from './auth/google-server.js';
import {ModalAccountManager} from './modal/modal-accounts.js';
import {ModalCliTokenVerifier} from './modal/modal-token-verifier.js';
import {LocalArtifactStore} from './storage/artifact-store.js';
import {ProjectDeletionService} from './jobs/project-deletion.js';
import {ProjectArchiveService} from './jobs/project-archive.js';
import {ProjectCloneService} from './jobs/project-clone.js';
import {RenderJobRepository} from './jobs/render-repository.js';
import {RenderArtifactStore} from './storage/render-artifacts.js';
import {GlbPreviewRepository} from './jobs/glb-preview-repository.js';
import {GlbPreviewArtifactStore} from './storage/glb-preview-artifacts.js';
import {UploadedAssetStore} from './storage/uploaded-assets.js';
import {UploadedAssets} from './jobs/uploaded-assets.js';
import {PublicShareRepository} from './jobs/public-shares.js';

const config=loadConfig();
const databaseConfig=databasePoolConfig();
if(Boolean(databaseConfig)!==(config.authMode!=='internal'||Boolean(config.ownerKey)))
  throw new Error('PostgreSQL connection and identity configuration must be configured together');
const pool=databaseConfig?new pg.Pool(databaseConfig):undefined;
const google=config.google&&pool?new GoogleOAuthServer(config.google,pool):undefined;
const modalAccounts=pool && process.env.MODAL_CREDENTIAL_ENCRYPTION_KEY
  ?ModalAccountManager.fromBase64(pool,process.env.MODAL_CREDENTIAL_ENCRYPTION_KEY,
    new ModalCliTokenVerifier()):undefined;
const projects=pool?new ProjectRepository(pool):undefined;
const artifacts=pool?new LocalArtifactStore(process.env.ARTIFACT_ROOT??'/data/blender-workspace'):undefined;
const projectDeletion=projects&&artifacts?new ProjectDeletionService(projects,artifacts):undefined;
const projectArchive=projects&&artifacts?new ProjectArchiveService(projects,artifacts):undefined;
const projectClone=projects&&artifacts?new ProjectCloneService(projects,artifacts):undefined;
const renderJobs=pool?new RenderJobRepository(pool):undefined;
const renderedImages=pool?new RenderArtifactStore(process.env.ARTIFACT_ROOT??'/data/blender-workspace'):undefined;
const glbPreviews=pool?new GlbPreviewRepository(pool):undefined;
const glbPreviewFiles=pool?new GlbPreviewArtifactStore(process.env.ARTIFACT_ROOT??'/data/blender-workspace'):undefined;
const uploads=pool?new UploadedAssets(pool,new UploadedAssetStore(
  process.env.ARTIFACT_ROOT??'/data/blender-workspace')):undefined;
const app=createApp(config,pool?{
  ownerKey:config.ownerKey,projects:projects!,jobs:new JobRepository(pool),
  artifacts:artifacts!,projectDeletion:projectDeletion!,projectArchive:projectArchive!,projectClone:projectClone!,
  renderJobs:renderJobs!,renderedImages:renderedImages!,
  glbPreviews:glbPreviews!,glbPreviewFiles:glbPreviewFiles!,
  uploads:uploads!,publicShares:new PublicShareRepository(pool),
  ...(modalAccounts?{modalAccounts}:{})
}:undefined,google?{google}:undefined);
if(pool)app.addHook('onClose',async()=>{await pool.end();});
// Retry pending file/DB cleanup on restart and while running. These passes
// never launch Blender and do not touch legacy soft-deleted projects.
let cleanupActive=false;
async function retryDeletion(){
  if(!projectDeletion||cleanupActive)return;
  cleanupActive=true;
  try{
    const result=await projectDeletion.resumePending();
    if(result.failed)app.log.warn({failed:result.failed},'Project deletion cleanup incomplete; retry scheduled');
  }catch{app.log.warn('Project deletion cleanup unavailable; retry scheduled');}
  finally{cleanupActive=false;}
}
await retryDeletion();
const cleanupTimer=setInterval(()=>{void retryDeletion();},60_000);
cleanupTimer.unref();
const shutdown=async()=>{clearInterval(cleanupTimer);await app.close();process.exit(0);};
process.once('SIGTERM',()=>void shutdown());
process.once('SIGINT',()=>void shutdown());
await app.listen({port:config.port,host:config.host});
