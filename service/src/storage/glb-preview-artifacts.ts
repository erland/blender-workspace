import {copyFile,lstat,mkdir,open,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileSha256,validUuid} from './render-artifacts.js';

const MAX_GLB_BYTES=128*1024*1024;
/** Immutable derived previews; never update the saved revision manifest. */
export class GlbPreviewArtifactStore {
 constructor(private readonly root:string){
   if(!path.isAbsolute(root))throw new RangeError('Absolute storage root required');
 }
 private name(project:string,job:string){
   return path.join(this.root,validUuid(project),'glb-previews',validUuid(job)+'.glb');
 }
 async publish(project:string,job:string,source:string):Promise<{sha256:string;sizeBytes:number}>{
   const info=await lstat(source);
   if(!info.isFile()||info.isSymbolicLink()||info.size<20||info.size>MAX_GLB_BYTES)
     throw new RangeError('Invalid GLB source');
   const {open:openFile}=await import('node:fs/promises');
   const handle=await openFile(source,'r');
   const header=Buffer.alloc(12);
   try{await handle.read(header,0,12,0);}finally{await handle.close();}
   if(header.toString('ascii',0,4)!=='glTF'||header.readUInt32LE(4)!==2
      ||header.readUInt32LE(8)!==info.size)
     throw new RangeError('Invalid GLB header');
   const destination=this.name(project,job);
   await mkdir(path.dirname(destination),{recursive:true,mode:0o700});
   const lock=await open(destination+'.lock','wx',0o600);
   const temporary=destination+'.pending';
   try{
     await copyFile(source,temporary,1);
     const copy=await lstat(temporary);
     if(!copy.isFile()||copy.size!==info.size||
        await fileSha256(temporary)!==await fileSha256(source))
       throw new Error('GLB changed during publication');
     const sha256=await fileSha256(temporary);
     await rename(temporary,destination);
     return {sha256,sizeBytes:copy.size};
   }finally{
     await lock.close();
     await rm(temporary,{force:true});
     await rm(destination+'.lock',{force:true});
   }
 }
 async verifiedPath(project:string,job:string,sha:string,size:number):Promise<string>{
   if(!/^[a-f0-9]{64}$/.test(sha)||!Number.isSafeInteger(size)
      ||size<20||size>MAX_GLB_BYTES)throw new RangeError('Invalid GLB metadata');
   const name=this.name(project,job);
   const info=await lstat(name);
   if(!info.isFile()||info.isSymbolicLink()||info.size!==size||
      await fileSha256(name)!==sha)throw new Error('Derived GLB checksum invalid');
   return name;
 }
 async inspectUncommitted(project:string,job:string):Promise<{sha256:string;sizeBytes:number}|null>{
   try{
     const name=this.name(project,job);
     const info=await lstat(name);
     if(!info.isFile()||info.isSymbolicLink()||info.size<20||
        info.size>MAX_GLB_BYTES)return null;
     const file=await open(name,'r');
     const h=Buffer.alloc(12);
     try{await file.read(h,0,12,0);}finally{await file.close();}
     if(h.toString('ascii',0,4)!=='glTF'||h.readUInt32LE(4)!==2||
        h.readUInt32LE(8)!==info.size)return null;
     return {sha256:await fileSha256(name),sizeBytes:info.size};
   }catch{return null;}
 }
}
