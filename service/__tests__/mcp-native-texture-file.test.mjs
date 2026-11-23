import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeTextureDownloader,decodeTextureBase64} from '../dist/mcp/texture-file-transfer.js';

const file={file_id:'file-test',download_url:'https://assets.example.test/file',
  file_name:'skin.png',mime_type:'image/png'};
const publicDns=async()=>[{address:'93.184.216.34',family:4}];
function fakeFetch(body,{status=200,headers={}}={}){
 return async()=>new Response(body,{status,headers});
}
test('DEV-054 native MCP file input streams bounded binary without Base64 payload',async()=>{
 const bytes=Buffer.alloc(2*1024*1024,13);
 const downloader=new NativeTextureDownloader({
   fetchImpl:fakeFetch(bytes,{headers:{'content-length':String(bytes.length)}}),
   lookup:publicDns
 });
 const result=await downloader.download(file);
 assert.deepEqual(result,bytes);
});
test('DEV-054 blocks private address, localhost, credentials, insecure scheme and unsafe redirects',async()=>{
 let networkCalls=0;
 const fetchImpl=async()=>{networkCalls++;return new Response(null,{status:302,
   headers:{location:'http://127.0.0.1/latest'}});};
 const downloader=new NativeTextureDownloader({fetchImpl,lookup:publicDns});
 await assert.rejects(downloader.download({...file,download_url:'http://assets.example.test/file'}),/public HTTPS/);
 await assert.rejects(downloader.download({...file,download_url:'https://127.0.0.1/private'}),/Private/);
 await assert.rejects(downloader.download({...file,download_url:'https://localhost/private'}),/Private/);
 await assert.rejects(downloader.download({...file,download_url:'https://user:pass@assets.example.test/file'}),/public HTTPS/);
 await assert.rejects(downloader.download({...file,download_url:'https://[::1]/private'}),/Private/);
 await assert.rejects(downloader.download(file),/public HTTPS/);
 assert.equal(networkCalls,1);
 const rebinding=new NativeTextureDownloader({fetchImpl,lookup:async()=>[
   {address:'93.184.216.34',family:4},{address:'10.0.0.2',family:4}
 ]});
 await assert.rejects(rebinding.download(file),/Private/);
});
test('DEV-054 rejects excess redirects and declared/streamed oversized images',async()=>{
 const toSame=new NativeTextureDownloader({fetchImpl:async()=>new Response(null,{
   status:302,headers:{location:'/more'}
 }),lookup:publicDns,maxRedirects:1});
 await assert.rejects(toSame.download(file),/Too many texture redirects/);
 const declared=new NativeTextureDownloader({fetchImpl:fakeFetch(Buffer.alloc(30),{
   headers:{'content-length':String(33*1024*1024)}
 }),lookup:publicDns});
 await assert.rejects(declared.download(file),/exceeds upload size/);
 const streamed=new NativeTextureDownloader({
   maxBytes:30,fetchImpl:fakeFetch(Buffer.alloc(100)),lookup:publicDns
 });
 await assert.rejects(streamed.download(file),/exceeds upload size/);
});
test('DEV-054 small client fallback checks strict and canonical Base64',()=>{
 const bytes=Buffer.alloc(1024,3);
 assert.deepEqual(decodeTextureBase64(bytes.toString('base64')),bytes);
 for(const input of ['bad@@@@','YQ==\n','YQ=',Buffer.alloc(200000).toString('base64')])
   assert.throws(()=>decodeTextureBase64(input),RangeError);
});
