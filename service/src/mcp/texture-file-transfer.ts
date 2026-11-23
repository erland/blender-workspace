/** Native MCP file input transport, modeled after Agent Workspace.
 * Accept the host-supplied short-lived HTTPS download_url; do not serialize
 * large binary images into JSON. Fail closed on private destinations and bound
 * redirects, time, and response bytes before persisting via UploadedAssets.
 */
import {lookup as dnsLookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {MAX_UPLOAD_BYTES} from '../storage/uploaded-assets.js';

export interface McpNativeFile {
 download_url:string; file_id:string; mime_type?:string; file_name?:string;
}
export interface TextureDownloadOptions {
 fetchImpl?:typeof fetch;
 lookup?:typeof dnsLookup;
 maxBytes?:number;
 maxRedirects?:number;
 timeoutMs?:number;
}

function privateIp(ip:string):boolean{
 const family=isIP(ip);
 if(family===4){
   const parts=ip.split('.').map(Number);
   const [a,b]=parts;
   if(a===undefined||b===undefined)return true;
   return a===0||a===10||a===127||a===169&&b===254||
     a===172&&b>=16&&b<=31||a===192&&b===168||
     a===100&&b>=64&&b<=127||a>=224;
 }
 if(family===6){
   const s=ip.toLowerCase();
   if(s==='::'||s==='::1'||/^f[cd]/.test(s)||/^fe[89ab]/.test(s))
     return true;
   const mapped=s.match(/^(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/);
   if(mapped)return privateIp(mapped[1]);
   // Reject non-global IPv6 scopes; a production deployment may use a
   // narrower allowlist once upstream file-host domains are established.
   if(s.includes('%'))return true;
   return false;
 }
 return true;
}

export class NativeTextureDownloader {
 private fetchImpl:typeof fetch;
 private lookup:typeof dnsLookup;
 private maxBytes:number;
 private maxRedirects:number;
 private timeoutMs:number;
 constructor(options:TextureDownloadOptions={}){
   this.fetchImpl=options.fetchImpl??fetch;
   this.lookup=options.lookup??dnsLookup;
   this.maxBytes=Math.min(options.maxBytes??MAX_UPLOAD_BYTES,MAX_UPLOAD_BYTES);
   this.maxRedirects=options.maxRedirects??3;
   this.timeoutMs=options.timeoutMs??30000;
 }
 private async validate(url:URL):Promise<void>{
   if(url.protocol!=='https:'||url.username||url.password||
     url.port&&url.port!=='443'||url.hostname.length>253)
     throw new RangeError('Texture URL must be public HTTPS');
   const hostname=url.hostname.replace(/^\[|\]$/g,'');
   if(hostname.toLowerCase()==='localhost')throw new RangeError('Private texture URL');
   if(isIP(hostname)){
     if(privateIp(hostname))throw new RangeError('Private texture URL');
   }else{
     const addrs=await this.lookup(hostname,{all:true,verbatim:true});
     if(!addrs.length||addrs.some(a=>privateIp(a.address)))
       throw new RangeError('Private texture URL');
   }
 }
 async download(file:McpNativeFile):Promise<Buffer>{
   if(!file.file_id?.trim()||file.file_id.length>512)
     throw new RangeError('Invalid MCP file id');
   let url:URL;
   try{url=new URL(file.download_url);}catch{throw new RangeError('Invalid MCP file URL');}
   for(let redirect=0;redirect<=this.maxRedirects;redirect++){
     await this.validate(url);
     let response:Response;
     try{
       response=await this.fetchImpl(url,{
         method:'GET',redirect:'manual',
         signal:AbortSignal.timeout(this.timeoutMs)
       });
     }catch{throw new RangeError('Texture download failed');}
     if([301,302,303,307,308].includes(response.status)){
       if(redirect===this.maxRedirects)throw new RangeError('Too many texture redirects');
       const location=response.headers.get('location');
       if(!location)throw new RangeError('Invalid texture redirect');
       url=new URL(location,url);
       continue;
     }
     if(!response.ok||!response.body)
       throw new RangeError('Texture download failed');
     const header=response.headers.get('content-length');
     if(header!==null){
       if(!/^\d+$/.test(header)||Number(header)>this.maxBytes)
         throw new RangeError('Texture exceeds upload size');
     }
     let size=0;
     const chunks:Buffer[]=[];
     const reader=response.body.getReader();
     try{
       while(true){
         const {done,value}=await reader.read();
         if(done)break;
         size+=value.byteLength;
         if(size>this.maxBytes)throw new RangeError('Texture exceeds upload size');
         chunks.push(Buffer.from(value));
       }
     }catch(error){
       await reader.cancel().catch(()=>{});
       throw error;
     }
     if(size<20)throw new RangeError('Texture is empty or too small');
     return Buffer.concat(chunks,size);
   }
   throw new RangeError('Texture download failed');
 }
}

export function decodeTextureBase64(encoded:string):Buffer{
 if(encoded.length>240000||
   encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
   throw new RangeError('Invalid or oversized texture base64');
 const bytes=Buffer.from(encoded,'base64');
 if(bytes.length<20||bytes.length>MAX_UPLOAD_BYTES||
   bytes.toString('base64')!==encoded)
   throw new RangeError('Invalid or oversized texture base64');
 return bytes;
}
