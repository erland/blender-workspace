/** Strict, bounded GLB v2 preflight. Never follows URI references. */
export const MAX_GLB_BYTES=120_000;
export const MAX_GLB_BASE64=160_000;
const parseJson=(bytes:Buffer)=>JSON.parse(bytes.toString('utf8').replace(/\u0000+$/g,'').trim());
export function inspectEmbeddedGlb(base64:string):{bytes:Buffer;meshCount:number}{
 if(typeof base64!=='string'||base64.length<28||base64.length>MAX_GLB_BASE64||
    base64.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
   throw new Error('Invalid bounded GLB base64');
 const bytes=Buffer.from(base64,'base64');
 if(bytes.toString('base64')!==base64||bytes.length<20||bytes.length>MAX_GLB_BYTES)
   throw new Error('GLB exceeds import bounds');
 if(bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||
    bytes.readUInt32LE(8)!==bytes.length)
   throw new Error('GLB v2 header invalid');
 const jsonSize=bytes.readUInt32LE(12);
 if(jsonSize<2||jsonSize>bytes.length-20||jsonSize%4!==0||
    bytes.toString('ascii',16,20)!=='JSON')
   throw new Error('GLB JSON chunk invalid');
 let gltf:any;
 try{gltf=parseJson(bytes.subarray(20,20+jsonSize));}
 catch{throw new Error('GLB JSON could not be decoded');}
 if(!gltf||typeof gltf!=='object'||gltf.asset?.version!=='2.0'||
   !Array.isArray(gltf.meshes)||gltf.meshes.length<1||gltf.meshes.length>128||
   !Array.isArray(gltf.nodes)||gltf.nodes.length>256||
   !Array.isArray(gltf.scenes)||gltf.scenes.length<1||
   !Array.isArray(gltf.accessors)||gltf.accessors.length>4096||
   gltf.buffers?.length>1||gltf.images?.length>128)
   throw new Error('GLB scene shape invalid');
 if(gltf.accessors.some((a:any)=>!a||!Number.isSafeInteger(a.count)||a.count<0||a.count>100000)||
    gltf.accessors.reduce((sum:number,a:any)=>sum+a.count,0)>200000)
   throw new Error('GLB accessor complexity exceeds bounds');
 if((gltf.buffers??[]).some((v:any)=>!v||typeof v!=='object'||v.uri!==undefined)||
    (gltf.images??[]).some((v:any)=>v?.uri!==undefined)||
    (gltf.extensionsRequired??[]).some((v:any)=>typeof v!=='string'||!v.startsWith('KHR_')))
   throw new Error('GLB must be self-contained');
 if(bytes.length>20+jsonSize){
   const pos=20+jsonSize;
   if(bytes.length-pos<8||bytes.toString('ascii',pos+4,pos+8)!=='BIN\u0000'||
      bytes.readUInt32LE(pos)!==bytes.length-pos-8)
     throw new Error('Invalid GLB binary chunk');
 }
 return {bytes,meshCount:gltf.meshes.length};
}
