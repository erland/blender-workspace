import {randomUUID,createHash} from 'node:crypto';
import {mkdir,open,lstat,rm,readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';

export const MAX_UPLOAD_BYTES=32*1024*1024;
export type UploadFormat='blend'|'glb';
export interface ValidatedUpload {format:UploadFormat;sizeBytes:number;sha256:string}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uid(s:string){if(!UUID.test(s))throw new RangeError('Invalid upload ID');return s.toLowerCase();}
function checkName(name:string){
 if(typeof name!=='string'||name.length<1||name.length>200||
    !/^[^/\\\0-\x1f\x7f]+\.(?:blend|glb)$/i.test(name))
   throw new RangeError('Invalid upload filename');
 return name;
}
function checkGltfDocument(bytes:Buffer){
 if(bytes.length<28||bytes.toString('ascii',0,4)!=='glTF'||
    bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)
   throw new RangeError('Invalid binary GLB');
 const chunkSize=bytes.readUInt32LE(12);
 if(bytes.toString('ascii',16,20)!=='JSON'||chunkSize===0||chunkSize%4||
    20+chunkSize>bytes.length)throw new RangeError('Invalid GLB JSON chunk');
 let doc:any;
 try{doc=JSON.parse(bytes.toString('utf8',20,20+chunkSize));}
 catch{throw new RangeError('Invalid GLB JSON');}
 if(!doc||doc.asset?.version!=='2.0'||!Array.isArray(doc.nodes)||
   !Array.isArray(doc.meshes)||!doc.meshes.length)
   throw new RangeError('GLB must contain importable geometry');
 for(const item of [...(doc.buffers??[]),...(doc.images??[])]){
   if(typeof item!=='object'||item===null||typeof item.uri==='string')
     throw new RangeError('External GLB resources are not supported');
 }
}
export function validateUpload(bytes:Buffer,filename:string):ValidatedUpload{
 const name=checkName(filename);
 if(!Buffer.isBuffer(bytes)||bytes.length<20||bytes.length>MAX_UPLOAD_BYTES)
   throw new RangeError('Upload must be 20 bytes to 32 MiB');
 const format=name.toLowerCase().endsWith('.blend')?'blend':'glb';
 if(format==='blend'){
   if(bytes.toString('ascii',0,7)!=='BLENDER'||![45,95].includes(bytes[7])||
       ![118,86].includes(bytes[8])||!['280','290','300','310','320','330','340','350','360','400','410','420','430','440','450','460','470','480','490','500','510'].includes(bytes.toString('ascii',9,12)))
      throw new RangeError('Unrecognized BLEND header');
 }else checkGltfDocument(bytes);
 return {format,sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
async function sha256(filename:string){
 const h=createHash('sha256');
 for await(const chunk of createReadStream(filename))h.update(chunk);
 return h.digest('hex');
}
/** Private immutable file area; id-only paths, no user-provided file paths. */
export class UploadedAssetStore {
 constructor(private readonly root:string){
  if(!path.isAbsolute(root))throw new RangeError('Absolute file storage required');
 }
 private filepath(id:string,format:UploadFormat){
  if(format!=='blend'&&format!=='glb')throw new RangeError('Unsupported format');
  return path.join(this.root,'.uploaded-assets',uid(id)+'.'+format);
 }
 async store(bytes:Buffer,id:string,format:UploadFormat){
  const destination=this.filepath(id,format);
  await mkdir(path.dirname(destination),{recursive:true,mode:0o700});
  const handle=await open(destination,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}
  catch(error){await handle.close();await rm(destination,{force:true});throw error;}
  await handle.close();
 }
 async verifiedPath(id:string,format:UploadFormat,sha:string,size:number){
  if(!/^[0-9a-f]{64}$/.test(sha)||!Number.isSafeInteger(size)||
     size<20||size>MAX_UPLOAD_BYTES)throw new RangeError('Invalid asset metadata');
  const filename=this.filepath(id,format);
  const info=await lstat(filename);
  if(!info.isFile()||info.isSymbolicLink()||info.size!==size||
     await sha256(filename)!==sha)throw new Error('Uploaded file checksum mismatch');
  return filename;
 }
 async remove(id:string,format:UploadFormat){await rm(this.filepath(id,format),{force:true});}
}
