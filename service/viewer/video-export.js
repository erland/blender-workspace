/** DEV-051: Browser-only 720p video capture from the existing GLB animation.
 * No remote conversion, Blender worker, authenticated download, or Modal call.
 * MediaRecorder encodes in real time: the 30 fps stream is a target, not a
 * guarantee if the device cannot render each frame.
 */
export const VIDEO_WIDTH=1280;
export const VIDEO_HEIGHT=720;
export const VIDEO_FPS=30;
export const MAX_VIDEO_SECONDS=120;
export const MAX_VIDEO_BYTES=128*1024*1024;

const FORMATS=[
  {format:'mp4',label:'MP4 (H.264)',types:[
    'video/mp4;codecs=avc1.42E01E','video/mp4']},
  {format:'webm',label:'WebM (VP8/VP9)',types:[
    'video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm']}
];

/** Never assume Safari/Chrome/Firefox can encode a specific codec. */
export function supportedVideoFormats(Recorder=globalThis.MediaRecorder){
  if(!Recorder||typeof Recorder.isTypeSupported!=='function')return [];
  return FORMATS.flatMap(item=>{
    const mimeType=item.types.find(type=>{
      try{return Recorder.isTypeSupported(type)===true;}catch{return false;}
    });
    return mimeType?[{format:item.format,label:item.label,mimeType}]:[];
  });
}

export function videoFileName(revision,clip,format){
  if(!['mp4','webm'].includes(format))throw new RangeError('Invalid video format');
  const name=String(clip).normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,48)||'animation';
  return 'blender-workspace-r'+revision+'-'+name+'.'+format;
}

export class VideoExportCancelled extends Error {
  constructor(){super('Exporten avbröts.');this.name='VideoExportCancelled';}
}

export function videoContainer(data){
  const bytes=data instanceof Uint8Array?data:new Uint8Array(data);
  if(bytes.length>=4&&bytes[0]===0x1a&&bytes[1]===0x45&&
     bytes[2]===0xdf&&bytes[3]===0xa3)return 'webm';
  if(bytes.length>=12&&String.fromCharCode(...bytes.subarray(4,8))==='ftyp')
    return 'mp4';
  return null;
}

/** Starts synchronously in a click handler for iOS user-gesture requirements.
 * Callers must immediately attach a handler to `done` and call cancel on
 * pagehide or when the user stops export. All tracks are stopped on completion.
 */
export function recordCanvasClip({
  canvas,durationSeconds,mimeType,drawFrame,onProgress=()=>{},
  Recorder=globalThis.MediaRecorder,
  requestFrame=globalThis.requestAnimationFrame,
  cancelFrame=globalThis.cancelAnimationFrame,
  clock=()=>performance.now(),
  isVisible=()=>!document.hidden,
  setDelay=globalThis.setTimeout,
  clearDelay=globalThis.clearTimeout
}){
  if(!Number.isFinite(durationSeconds)||durationSeconds<=0||
     durationSeconds>MAX_VIDEO_SECONDS)
    throw new RangeError('Animationen måste vara högst 120 sekunder.');
  if(!FORMATS.some(f=>f.types.includes(mimeType))||
     !supportedVideoFormats(Recorder).some(f=>f.mimeType===mimeType))
    throw new RangeError('Det valda videoformatet stöds inte.');
  if(!canvas||typeof canvas.captureStream!=='function'||
     typeof requestFrame!=='function'||typeof cancelFrame!=='function')
    throw new Error('Den här webbläsaren kan inte spela in 3D-vyn.');

  let recorder,stream,frameId=null,stopDelay=null,finished=false,bytes=0;
  let resolveDone,rejectDone;
  const chunks=[];
  const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});
  const cleanup=()=>{
    if(frameId!==null){cancelFrame(frameId);frameId=null;}
    if(stopDelay!==null){clearDelay(stopDelay);stopDelay=null;}
    for(const track of stream?.getTracks?.()??[]){
      try{track.stop();}catch{}
    }
  };
  const fail=error=>{
    if(finished)return;
    finished=true;
    cleanup();
    try{if(recorder?.state!=='inactive')recorder.stop();}catch{}
    rejectDone(error instanceof Error?error:new Error('Kunde inte skapa videon.'));
  };
  const cancel=()=>fail(new VideoExportCancelled());
  const stop=()=>{
    if(finished)return;
    try{
      if(recorder.state==='inactive')throw new Error('Videokodningen avbröts.');
      recorder.stop();
    }catch{fail(new Error('Kunde inte avsluta videon.'));}
  };
  try{
    stream=canvas.captureStream(VIDEO_FPS);
    if(!stream?.getVideoTracks?.().length)
      throw new Error('Det gick inte att spela in 3D-vyn.');
    recorder=new Recorder(stream,{mimeType,videoBitsPerSecond:3_000_000});
    recorder.ondataavailable=event=>{
      if(finished||!event.data||!event.data.size)return;
      bytes+=event.data.size;
      if(bytes>MAX_VIDEO_BYTES){
        fail(new Error('Videon blev för stor (max 128 MiB).'));
        return;
      }
      chunks.push(event.data);
    };
    recorder.onerror=()=>fail(new Error('Webbläsarens videokodning misslyckades.'));
    recorder.onstop=async()=>{
      if(finished)return;
      finished=true;cleanup();
      try{
        if(!chunks.length)throw new Error('Webbläsaren skapade ingen video.');
        const selectedFormat=mimeType.startsWith('video/mp4')?'mp4':'webm';
        const result=new Blob(chunks,{type:'video/'+selectedFormat});
        const header=new Uint8Array(await result.slice(0,16).arrayBuffer());
        if(videoContainer(header)!==selectedFormat)
          throw new Error('Videoformatet stämde inte med filinnehållet.');
        resolveDone({blob:result,format:selectedFormat,durationSeconds});
      }catch(error){rejectDone(error);}
    };
    recorder.start(500);
    const started=clock();
    let lastFrame=-1;
    const tick=timestamp=>{
      frameId=null;
      if(finished)return;
      if(!isVisible()){
        fail(new Error('Exporten avbröts eftersom fliken inte längre är aktiv.'));
        return;
      }
      const elapsed=Math.min(durationSeconds,Math.max(0,(timestamp-started)/1000));
      if(lastFrame<0||elapsed-lastFrame>=1/VIDEO_FPS-0.004||elapsed===durationSeconds){
        try{
          drawFrame(elapsed);
          onProgress(elapsed,durationSeconds);
        }catch{fail(new Error('Det gick inte att rita videons bildrutor.'));return;}
        lastFrame=elapsed;
      }
      if(elapsed>=durationSeconds){
        // Keep the final frame visible briefly to allow the encoder to
        // capture the final state before closing the stream.
        stopDelay=setDelay(stop,150);
      }else frameId=requestFrame(tick);
    };
    frameId=requestFrame(tick);
  }catch(error){fail(error);}
  return {done,cancel};
}
