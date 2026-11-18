import pg from 'pg';
import {createApp} from './app.js';
import {loadConfig} from './config.js';
import {ProjectRepository} from './db/projects.js';
import {JobRepository} from './jobs/job-repository.js';
import {GoogleOAuthServer} from './auth/google-server.js';
import {ModalAccountManager} from './modal/modal-accounts.js';
import {ModalCliTokenVerifier} from './modal/modal-token-verifier.js';
import {LocalArtifactStore} from './storage/artifact-store.js';

const config=loadConfig();
const databaseUrl=process.env.DATABASE_URL;
if(Boolean(databaseUrl)!==(config.authMode!=='internal'||Boolean(config.ownerKey)))
  throw new Error('DATABASE_URL and identity configuration must be configured together');
const pool=databaseUrl?new pg.Pool({connectionString:databaseUrl,max:5,connectionTimeoutMillis:5000}):undefined;
const google=config.google&&pool?new GoogleOAuthServer(config.google,pool):undefined;
const modalAccounts=pool && process.env.MODAL_CREDENTIAL_ENCRYPTION_KEY
  ?ModalAccountManager.fromBase64(pool,process.env.MODAL_CREDENTIAL_ENCRYPTION_KEY,
    new ModalCliTokenVerifier()):undefined;
const app=createApp(config,pool?{
  ownerKey:config.ownerKey,projects:new ProjectRepository(pool),jobs:new JobRepository(pool),
  artifacts:new LocalArtifactStore(process.env.ARTIFACT_ROOT??'/data/blender-workspace'),
  ...(modalAccounts?{modalAccounts}:{})
}:undefined,google?{google}:undefined);
if(pool)app.addHook('onClose',async()=>{await pool.end();});
const shutdown=async()=>{await app.close();process.exit(0);};
process.once('SIGTERM',()=>void shutdown());
process.once('SIGINT',()=>void shutdown());
await app.listen({port:config.port,host:config.host});
