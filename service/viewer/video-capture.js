/** Shared browser-only video canvas/renderer for owner and public GLB viewers. */
import * as THREE from 'three';
import {recordCanvasClip} from './video-export.js';
import {orbitPosition,orbitHasPerspective} from './video-orbit.js';
export function createViewerRecording({scene,sourceCamera,sourceRenderer,target,
  mode,durationSeconds,mimeType,width,height,onFrame=()=>{},onProgress=()=>{}}){
  if(!scene||!sourceCamera||!sourceRenderer||!target)
    throw new Error('Ingen 3D-vy är redo för videoexport.');
  if(!['orbit','animation'].includes(mode))throw new RangeError('Ogiltig exporttyp.');
  if(![1280,1920].includes(width)||height!==width*9/16)
    throw new RangeError('Ogiltiga videodimensioner.');
  const start=sourceCamera.position.toArray(),center=target.toArray();
  if(mode==='orbit'&&!orbitHasPerspective(start,center))
    throw new Error('Välj en sned kameravy för en synlig 360°-rotation.');
  let canvas=null,renderer=null;
  const cleanup=()=>{
    try{renderer?.dispose();renderer?.forceContextLoss();}catch{}
    canvas?.remove();
  };
  try{
    canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    canvas.setAttribute('aria-hidden','true');
    canvas.style.cssText='position:fixed;left:-10000px;top:0;width:1px;height:1px;pointer-events:none';
    document.body.append(canvas);
    renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
    renderer.setPixelRatio(1);renderer.setSize(width,height,false);
    renderer.outputColorSpace=sourceRenderer.outputColorSpace;
    renderer.toneMapping=sourceRenderer.toneMapping;
    const camera=sourceCamera.clone();camera.aspect=width/height;camera.updateProjectionMatrix();
    const drawFrame=seconds=>{
      if(mode==='orbit'){
        camera.position.fromArray(orbitPosition(start,center,seconds,durationSeconds));
        camera.lookAt(target);
      }
      onFrame(seconds);renderer.render(scene,camera);
    };
    drawFrame(0); // Prime canvas, then start MediaRecorder in the click handler.
    const recording=recordCanvasClip({canvas,durationSeconds,mimeType,drawFrame,onProgress});
    recording.done.then(cleanup,cleanup);
    return recording;
  }catch(error){cleanup();throw error;}
}
