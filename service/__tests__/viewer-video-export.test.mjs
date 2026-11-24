import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {viewerPage} from '../dist/viewer-page.js';
import {supportedVideoFormats,videoFileName,videoContainer,recordCanvasClip,
  VideoExportCancelled,VIDEO_WIDTH,VIDEO_HEIGHT,VIDEO_FPS,MAX_VIDEO_SECONDS,
  MAX_VIDEO_BYTES} from '../viewer/video-export.js';

function recorderWithSupport(allowed){
  return class Recorder {
    static isTypeSupported(type){return allowed.includes(type);}
    constructor(stream,options){
      this.stream=stream;this.mimeType=options.mimeType;this.state='inactive';
      this.startCalls=[];this.stopCalls=0;Recorder.latest=this;
    }
    start(slice){this.startCalls.push(slice);this.state='recording';}
    stop(){
      this.stopCalls++;this.state='inactive';
      const header=this.mimeType.includes('mp4')
        ?new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109,0])
        :new Uint8Array([0x1a,0x45,0xdf,0xa3,0,0,0,0]);
      this.ondataavailable?.({data:new Blob([header],{type:this.mimeType})});
      this.onstop?.();
    }
  };
}

function harness({format='video/mp4',durationSeconds=1,visible=()=>true}={}){
  const Recorder=recorderWithSupport([format]);
  const frames=[],tracks=[{stops:0,stop(){this.stops++;}}];
  let requestedFps=0,timer;
  const canvas={captureStream(fps){requestedFps=fps;return {
    getVideoTracks(){return tracks;},getTracks(){return tracks;}
  };}};
  const draws=[],progress=[];
  const controller=recordCanvasClip({
    canvas,Recorder,mimeType:format,durationSeconds,
    drawFrame:time=>draws.push(time),
    onProgress:(time,total)=>progress.push([time,total]),
    requestFrame:callback=>{frames.push(callback);return frames.length;},
    cancelFrame:()=>{},clock:()=>0,isVisible:visible,
    setDelay:callback=>{timer=callback;return 10;},
    clearDelay:()=>{timer=null;}
  });
  return {controller,Recorder,draws,progress,tracks,frames,
    get fps(){return requestedFps;},
    runFrame(now){const callback=frames.shift();assert.ok(callback,'missing RAF');callback(now);},
    finish(){assert.ok(timer,'missing delayed stop');timer();}
  };
}

test('DEV-051 offers only device-supported MP4/WebM containers, preferring MP4',()=>{
 const both=recorderWithSupport(['video/mp4','video/webm;codecs=vp8']);
 assert.deepEqual(supportedVideoFormats(both).map(f=>f.format),['mp4','webm']);
 const one=recorderWithSupport(['video/webm;codecs=vp9']);
 assert.deepEqual(supportedVideoFormats(one).map(f=>f.mimeType),
   ['video/webm;codecs=vp9']);
 assert.deepEqual(supportedVideoFormats(null),[]);
 const broken={isTypeSupported(){throw new Error('not supported');}};
 assert.deepEqual(supportedVideoFormats(broken),[]);
 assert.equal(VIDEO_WIDTH,1280);assert.equal(VIDEO_HEIGHT,720);
 assert.equal(VIDEO_FPS,30);assert.equal(MAX_VIDEO_SECONDS,120);
 assert.equal(videoFileName(12,'Huvudvridning & körning','mp4'),
   'blender-workspace-r12-Huvudvridning-korning.mp4');
 assert.throws(()=>videoFileName(1,'X','mov'),/Invalid/);
});

test('DEV-051 records a clip from time zero to end at 30 fps and stops video track',async()=>{
 const h=harness();assert.equal(h.fps,30);
 assert.equal(h.Recorder.latest.state,'recording');
 assert.deepEqual(h.Recorder.latest.startCalls,[500]);
 h.runFrame(0);h.runFrame(500);h.runFrame(1000);
 assert.deepEqual(h.draws,[0,0.5,1]);
 assert.deepEqual(h.progress.map(p=>p[0]),[0,0.5,1]);
 assert.equal(h.tracks[0].stops,0);
 h.finish();
 const result=await h.controller.done;
 assert.equal(result.format,'mp4');
 assert.equal(result.blob.type,'video/mp4');
 assert.equal(result.durationSeconds,1);
 assert.equal(videoContainer(new Uint8Array(await result.blob.arrayBuffer())),'mp4');
 assert.equal(h.tracks[0].stops,1);
 assert.equal(h.Recorder.latest.stopCalls,1);
});

test('DEV-051 handles WebM recording, keeps extension matching encoded bytes',async()=>{
 const h=harness({format:'video/webm',durationSeconds:0.2});
 h.runFrame(0);h.runFrame(200);h.finish();
 const result=await h.controller.done;
 assert.equal(result.format,'webm');
 assert.equal(videoContainer(new Uint8Array(await result.blob.arrayBuffer())),'webm');
 assert.equal(result.blob.type,'video/webm');
 assert.equal(h.tracks[0].stops,1);
});

test('DEV-051 cancel and hidden-tab failures stop tracks without output',async()=>{
 const cancelled=harness();
 const done=cancelled.controller.done.catch(e=>e);
 cancelled.controller.cancel();
 assert.ok(await done instanceof VideoExportCancelled);
 assert.equal(cancelled.tracks[0].stops,1);
 const hidden=harness({visible:()=>false});
 const hiddenError=hidden.controller.done.catch(e=>e);
 hidden.runFrame(0);
 assert.match((await hiddenError).message,/fliken inte längre är aktiv/);
 assert.equal(hidden.tracks[0].stops,1);
});

test('DEV-051 bounds duration, unsupported codec, and encoded file size',async()=>{
 const Recorder=recorderWithSupport(['video/mp4']);
 const options={canvas:{captureStream(){throw new Error('should not call');}},
   mimeType:'video/mp4',drawFrame:()=>{},Recorder,requestFrame:()=>1,cancelFrame:()=>{}};
 assert.throws(()=>recordCanvasClip({...options,durationSeconds:121}),/120 sekunder/);
 assert.throws(()=>recordCanvasClip({...options,durationSeconds:0}),/120 sekunder/);
 assert.throws(()=>recordCanvasClip({...options,durationSeconds:1,mimeType:'video/webm'}),
   /stöds inte/);
 const h=harness();
 const result=h.controller.done.catch(e=>e);
 h.Recorder.latest.ondataavailable({data:{size:MAX_VIDEO_BYTES+1}});
 assert.match((await result).message,/128 MiB/);
 assert.equal(h.tracks[0].stops,1);
});

test('DEV-051 no mismatched file extension when encoder returns unexpected container',async()=>{
 const h=harness();
 const result=h.controller.done.catch(e=>e);
 h.Recorder.latest.stop=()=>{
   h.Recorder.latest.state='inactive';
   h.Recorder.latest.ondataavailable({data:new Blob([
     new Uint8Array([0x1a,0x45,0xdf,0xa3,0,0,0,0])
   ])});
   h.Recorder.latest.onstop();
 };
 h.runFrame(0);h.runFrame(1000);h.finish();
 assert.match((await result).message,/filinnehållet/);
});

test('DEV-051 viewer provides responsive accessible UI for GLB exports',async()=>{
 const html=viewerPage('11111111-1111-4111-8111-111111111111',1);
 for(const id of ['animation-video','video-format','video-start','video-cancel',
    'video-download','video-share','video-status'])
   assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(html,/id="animation-bar"[^>]*hidden/);
 assert.match(html,/role="status" aria-live="polite"/);
 assert.match(html,/720p/);
 const client=await readFile(new URL('../viewer/client.js',import.meta.url),'utf8');
 assert.match(client,/createViewerRecording\(/);
 assert.match(client,/supportedVideoFormats\(/);
 assert.match(client,/videoDownload\.download=/);
 assert.match(client,/navigator\.canShare/);
 assert.match(client,/activeVideo\?\.controller\.cancel\(\)/);
 const helper=await readFile(new URL('../viewer/video-export.js',import.meta.url),'utf8');
 assert.doesNotMatch(helper,/fetch\s*\(|ModalPythonExecutor|workspace_queue_python_script/);
});

import {videoSize,ORBIT_DURATIONS,orbitPosition,orbitHasPerspective}
  from '../viewer/video-orbit.js';
import {publicSharePage} from '../dist/web/public-share-page.js';

test('DEV-060 orbit preserves height, radius, and returns to exact initial position',()=>{
 assert.deepEqual(ORBIT_DURATIONS,[10,15,30,60]);
 assert.deepEqual(videoSize('720'),{width:1280,height:720});
 assert.deepEqual(videoSize('1080'),{width:1920,height:1080});
 assert.throws(()=>videoSize('4k'),/upplösning/);
 const start=[10,8,0],target=[2,3,0];
 assert.deepEqual(orbitPosition(start,target,0,10),start);
 const half=orbitPosition(start,target,5,10);
 assert.ok(Math.abs(half[0]+6)<1e-10);
 assert.equal(half[1],8);
 assert.ok(Math.abs(half[2])<1e-10);
 const end=orbitPosition(start,target,10,10);
 assert.ok(Math.abs(end[0]-start[0])<1e-10);
 assert.ok(Math.abs(end[2]-start[2])<1e-10);
 assert.equal(end[1],start[1]);
 assert.equal(orbitHasPerspective(start,target),true);
 assert.equal(orbitHasPerspective([2,10,0],target),false);
 assert.throws(()=>orbitPosition(start,target,1,9),/kameravärden/);
 assert.throws(()=>orbitPosition(start,target,NaN,10),/kameravärden/);
});

test('DEV-060 both viewer shells expose orbit export independently of animation presence',async()=>{
 const owner=viewerPage('11111111-1111-4111-8111-111111111111',1);
 const pub=publicSharePage('x'.repeat(43),'Testmodell',1);
 for(const html of [owner,pub]){
   for(const id of ['animation-video','video-mode','video-duration',
     'video-resolution','video-format','video-start','video-cancel',
     'video-download','video-share','video-status'])
     assert.ok(html.includes('id="'+id+'"'),id);
   assert.match(html,/360° kamerarotation/);
   assert.match(html,/1080p/);
 }
 const privateJs=await readFile(new URL('../viewer/client.js',import.meta.url),'utf8');
 const publicJs=await readFile(new URL('../viewer/public-client.js',import.meta.url),'utf8');
 const shared=await readFile(new URL('../viewer/video-capture.js',import.meta.url),'utf8');
 for(const js of [privateJs,publicJs]){
   assert.match(js,/createViewerRecording\(/);
   assert.match(js,/activeVideo\?\.controller\.cancel\(\)/);
   assert.match(js,/supportedVideoFormats\(/);
 }
 assert.match(shared,/recordCanvasClip\(/);
 assert.match(shared,/orbitPosition\(/);
 assert.doesNotMatch(shared,/fetch\s*\(|ModalPythonExecutor|workspace_queue_python_script/);
});
