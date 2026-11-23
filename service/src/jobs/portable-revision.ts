import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,stat,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {LocalArtifactStore} from '../storage/artifact-store.js';

const run=promisify(execFile);
/** Single shared packaging path for authenticated and public revisions.
 * Return only an archive of a fully verified, immutable revision. The caller
 * must clean up `directory` after the download stream closes.
 */
export async function buildPortableRevisionZip(
  artifacts:Pick<LocalArtifactStore,'inspect'|'verifiedArtifactPath'|'verifiedRevisionResources'>,
  projectId:string,revision:number
):Promise<{archive:string;directory:string}>{
  // First verify all bytes in the revision, including its external resource
  // manifest. No caller can request arbitrary filesystem paths or hashes.
  const manifest=await artifacts.inspect(projectId,revision,true);
  const original=manifest.artifacts.find(a=>a.name==='scene.blend');
  if(!original)throw new Error('Missing committed Blender original');
  const scene=await artifacts.verifiedArtifactPath(projectId,revision,'scene.blend');
  const resources=await artifacts.verifiedRevisionResources(projectId,revision);
  const directory=await mkdtemp(path.join(os.tmpdir(),'bw-portable-revision-'));
  const archive=path.join(directory,'revision.zip');
  try{
    const spec=path.join(directory,'request.json');
    await writeFile(spec,JSON.stringify({
      blend:{path:scene,sha256:original.sha256,sizeBytes:original.sizeBytes},
      resources:resources.map(({name,path:source,sha256,sizeBytes})=>({
        name,path:source,sha256,sizeBytes
      }))
    }),{flag:'wx',mode:0o600});
    await run('python3',[path.join(process.cwd(),'revision_zip.py'),spec,archive],{
      timeout:120000,maxBuffer:4096
    });
    if((await stat(archive)).size>256*1024*1024)throw new Error('Archive exceeds limit');
    return {archive,directory};
  }catch(error){
    await rm(directory,{recursive:true,force:true});
    throw error;
  }
}
