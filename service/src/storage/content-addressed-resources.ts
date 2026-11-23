import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,constants as fsConstants} from 'node:fs';
import {copyFile,link,lstat,mkdir,open,rm} from 'node:fs/promises';
import path from 'node:path';

const HASH=/^[0-9a-f]{64}$/;
const MAX_RESOURCE_BYTES=256*1024*1024;
export interface StoredResource {
  sha256:string;
  sizeBytes:number;
}
async function fingerprint(file:string):Promise<string>{
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}
async function regularFile(file:string):Promise<number>{
  const info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.size<1||
      info.size>MAX_RESOURCE_BYTES)
    throw new RangeError('Unsafe resource file or size');
  return info.size;
}
async function realDirectory(dir:string):Promise<void>{
  await mkdir(dir,{recursive:true,mode:0o700});
  const info=await lstat(dir);
  if(!info.isDirectory()||info.isSymbolicLink())
    throw new Error('Unsafe resource directory');
}

/** Immutable content-addressed bytes, shared by revision manifests.
 * This is deliberately NOT a public or user-addressable read API: callers
 * must resolve an owned revision's manifest before requesting a resource.
 * Garbage collection is deliberately absent until transactional reference
 * accounting and an orphan-grace period are implemented.
 */
export class ContentAddressedResourceStore {
  private readonly root:string;
  constructor(volumeRoot:string){
    if(!path.isAbsolute(volumeRoot))
      throw new RangeError('Resource volume must be absolute');
    this.root=path.join(path.resolve(volumeRoot),'.resources','sha256');
  }
  private resourcePath(sha256:string):string{
    if(!HASH.test(sha256))throw new RangeError('Invalid SHA-256');
    return path.join(this.root,sha256.slice(0,2),sha256);
  }
  /** Return an immutable file identity, deduplicating identical bytes.
   * Files are copied into the destination filesystem and then linked into
   * place without ever exposing a partially written final resource.
   */
  async put(source:string):Promise<StoredResource>{
    const size=await regularFile(source);
    const hash=await fingerprint(source);
    const destination=this.resourcePath(hash);
    const shard=path.dirname(destination);
    await realDirectory(this.root);
    await realDirectory(shard);
    const temp=path.join(shard,'.upload-'+randomUUID());
    try{
      await copyFile(source,temp,fsConstants.COPYFILE_EXCL);
      if(await regularFile(temp)!==size||await fingerprint(temp)!==hash||
         await regularFile(source)!==size||await fingerprint(source)!==hash)
        throw new Error('Source resource changed during upload');
      const handle=await open(temp,'r');
      try{await handle.sync();}finally{await handle.close();}
      try{await link(temp,destination);}
      catch(error){
        if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      }
      // An already-existing resource must still match the proposed bytes.
      if(await regularFile(destination)!==size||
         await fingerprint(destination)!==hash)
        throw new Error('Corrupt existing resource');
      return {sha256:hash,sizeBytes:size};
    }finally{await rm(temp,{force:true});}
  }
  /** For trusted internally validated revision manifests only. */
  async verifiedPath(resource:StoredResource):Promise<string>{
    if(!Number.isSafeInteger(resource.sizeBytes)||resource.sizeBytes<1||
       resource.sizeBytes>MAX_RESOURCE_BYTES)
      throw new RangeError('Invalid expected resource size');
    const filename=this.resourcePath(resource.sha256);
    if(await regularFile(filename)!==resource.sizeBytes||
       await fingerprint(filename)!==resource.sha256)
      throw new Error('Resource checksum mismatch');
    return filename;
  }
}
