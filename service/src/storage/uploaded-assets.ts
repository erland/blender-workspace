import {randomUUID,createHash} from 'node:crypto';
import {mkdir,open,lstat,rm,readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';

export const MAX_UPLOAD_BYTES=32*1024*1024;
export type UploadFormat='blend'|'glb'|'png'|'jpg';
export interface ValidatedUpload {format:UploadFormat;sizeBytes:number;sha256:string}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uid(s:string){if(!UUID.test(s))throw new RangeError('Invalid upload ID');return s.toLowerCase();}
function checkName(name:string){
 if(typeof name!=='string'||name.length<1||name.length>200||
    !/^[^/\\\0-\x1f\x7f]+\.(?:blend|glb|png|jpe?g)$/i.test(name))
   throw new RangeError('Invalid upload filename');
 return name;
}
/** Blender can save native .blend files as Zstandard (since Blender 3.0).
 * The compressed header is 28 B5 2F FD instead of the literal BLENDER header.
 * Compression is decoded only by Blender inside the isolated Sandbox, never
 * by the authenticated service, to avoid decompression bombs on upload.
 */
const BLEND_ZSTD_MAGIC=Buffer.from([0x28,0xb5,0x2f,0xfd]);
function isNativeBlend(bytes:Buffer):boolean{
  if(bytes.subarray(0,4).equals(BLEND_ZSTD_MAGIC))return true;
  return bytes.toString('ascii',0,7)==='BLENDER'&&
    [45,95].includes(bytes[7])&&[118,86].includes(bytes[8])&&
    ['280','290','300','310','320','330','340','350','360',
     '400','410','420','430','440','450','460','470','480','490','500','510']
      .includes(bytes.toString('ascii',9,12));
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
/** Reject non-image payloads and pathological dimensions before storing.
 * Blender remains the authoritative decoder in a network-isolated Sandbox.
 */
function checkTexture(bytes:Buffer,format:'png'|'jpg'):void{
 if(format==='png'){
  if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
     bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(8)!==13||
     bytes[24]!==8||![0,2,4,6].includes(bytes[25]))
    throw new RangeError('Invalid PNG texture');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(width<1||height<1||width>8192||height>8192||width*height>16777216)
    throw new RangeError('Invalid texture dimensions');
 }else{
  if(bytes.length<32||bytes[0]!==0xff||bytes[1]!==0xd8||
     bytes[bytes.length-2]!==0xff||bytes[bytes.length-1]!==0xd9)
    throw new RangeError('Invalid JPEG texture');
  // Parse the bounded JPEG marker stream to find actual dimensions.
  let offset=2,dimensions=false;
  while(offset+4<bytes.length){
   if(bytes[offset]!==0xff)break;
   let marker=bytes[offset+1];
   while(marker===0xff&&offset+2<bytes.length){offset++;marker=bytes[offset+1];}
   if(marker===0xda)break;
   if(marker===0xd8||marker===0xd9||marker===0x01||
      marker>=0xd0&&marker<=0xd7){offset+=2;continue;}
   const size=bytes.readUInt16BE(offset+2);
   if(size<2||offset+2+size>bytes.length)break;
   if([0xc0,0xc1,0xc2].includes(marker)){
     if(size<7)break;
     const h=bytes.readUInt16BE(offset+5),w=bytes.readUInt16BE(offset+7);
     if(w<1||h<1||w>8192||h>8192||w*h>16777216)
       throw new RangeError('Invalid texture dimensions');
     dimensions=true;break;
   }
   offset+=2+size;
  }
  if(!dimensions)throw new RangeError('Invalid JPEG texture');
 }
}
export function validateUpload(bytes:Buffer,filename:string):ValidatedUpload{
 const name=checkName(filename);
 if(!Buffer.isBuffer(bytes)||bytes.length<20||bytes.length>MAX_UPLOAD_BYTES)
   throw new RangeError('Upload must be 20 bytes to 32 MiB');
 const suffix=name.toLowerCase().split('.').at(-1);
 const format:UploadFormat=suffix==='blend'?'blend':suffix==='glb'?'glb':
   suffix==='png'?'png':'jpg';
 if(format==='blend'){
   if(!isNativeBlend(bytes))
      throw new RangeError('Unrecognized BLEND header');
 }else if(format==='glb')checkGltfDocument(bytes);
 else checkTexture(bytes,format);
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
  if(!['blend','glb','png','jpg'].includes(format))throw new RangeError('Unsupported format');
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
