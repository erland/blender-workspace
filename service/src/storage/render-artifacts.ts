import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,copyFile,lstat,readFile,rename,rm,writeFile,open} from 'node:fs/promises';
import path from 'node:path';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_PNG_BYTES=16*1024*1024;
export function validUuid(id:string):string{
 if(!UUID.test(id))throw new RangeError('Invalid UUID');return id.toLowerCase();
}
export async function fileSha256(filename:string):Promise<string>{
 const h=createHash('sha256');
 for await(const b of createReadStream(filename))h.update(b);
 return h.digest('hex');
}
/** Separate derived preview directory; immutable model revision manifests are untouched. */
export class RenderArtifactStore {
 constructor(private readonly root:string){
   if(!path.isAbsolute(root))throw new RangeError('Absolute storage root required');
 }
 private dir(project:string){return path.join(this.root,validUuid(project),'renders');}
 private filename(project:string,job:string){return path.join(this.dir(project),validUuid(job)+'.png');}
 async publish(project:string,job:string,source:string):Promise<{sha256:string;sizeBytes:number}>{
   const info=await lstat(source);
   if(!info.isFile()||info.isSymbolicLink()||info.size<33||info.size>MAX_PNG_BYTES)
     throw new RangeError('Invalid render output');
   const header=await readFile(source);
   if(!header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
      header.toString('ascii',12,16)!=='IHDR')
      throw new RangeError('Invalid PNG signature');
   const dir=this.dir(project);
   await mkdir(dir,{recursive:true,mode:0o700});
   const dest=this.filename(project,job);
   const stage=dest+'.pending';
   const lock=await open(dest+'.lock','wx',0o600);
   try{
     await copyFile(source,stage,1);
     const copied=await lstat(stage);
     if(!copied.isFile()||copied.size!==info.size||
       await fileSha256(stage)!==await fileSha256(source))
       throw new Error('Rendered PNG changed while saving');
     const checksum=await fileSha256(stage);
     await rename(stage,dest);
     return {sha256:checksum,sizeBytes:copied.size};
   }finally{
     await lock.close();
     await rm(stage,{force:true});
     await rm(dest+'.lock',{force:true});
   }
 }
 async verifiedPath(project:string,job:string,checksum:string,length:number):Promise<string>{
   if(!/^[0-9a-f]{64}$/.test(checksum)||!Number.isSafeInteger(length)||
      length<33||length>MAX_PNG_BYTES)throw new RangeError('Invalid render metadata');
   const filename=this.filename(project,job);
   const info=await lstat(filename);
   if(!info.isFile()||info.isSymbolicLink()||info.size!==length||
      await fileSha256(filename)!==checksum)throw new Error('Render integrity invalid');
   return filename;
 }
 async inspectUncommitted(project:string,job:string):Promise<{sha256:string;sizeBytes:number}|null>{
   try{
     const filename=this.filename(project,job);
     const stat=await lstat(filename);
     if(!stat.isFile()||stat.isSymbolicLink()||stat.size<33||stat.size>MAX_PNG_BYTES)return null;
     const image=await readFile(filename);
     if(!image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return null;
     return {sha256:await fileSha256(filename),sizeBytes:stat.size};
   }catch{return null;}
 }
}
