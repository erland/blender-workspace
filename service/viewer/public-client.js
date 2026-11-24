import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {supportedVideoFormats,MAX_VIDEO_SECONDS,videoFileName,VideoExportCancelled} from './video-export.js';
import {videoSize,ORBIT_DURATIONS} from './video-orbit.js';
import {createViewerRecording} from './video-capture.js';

// The public viewer deliberately has no authenticated private API references,
// owner controls, comparison links, upload or billed Modal/render endpoints.
const match=location.pathname.match(/^\/share\/([A-Za-z0-9_-]{43})$/);
if(!match)throw new Error('Ogiltig publik delningslänk');
const token=match[1];
const canvas=document.getElementById('public-viewport');
const status=document.getElementById('public-status');
const animationControls=document.getElementById('animation-controls');
const clipPicker=document.getElementById('public-clip');
const playButton=document.getElementById('public-play');
const loopToggle=document.getElementById('public-loop');
const videoMode=document.getElementById('video-mode');
const videoDuration=document.getElementById('video-duration');
const videoResolution=document.getElementById('video-resolution');
const videoFormat=document.getElementById('video-format');
const videoStart=document.getElementById('video-start');
const videoCancel=document.getElementById('video-cancel');
const videoDownload=document.getElementById('video-download');
const videoShare=document.getElementById('video-share');
const videoStatus=document.getElementById('video-status');
let modelLoaded=false,activeVideo=null,videoObjectUrl=null,videoSharedFile=null;
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
const scene=new THREE.Scene();
scene.background=new THREE.Color(0xf1f4f8);
scene.add(new THREE.HemisphereLight(0xffffff,0x94a3b8,2.4));
const light=new THREE.DirectionalLight(0xffffff,2);
light.position.set(3,7,5);scene.add(light);
const camera=new THREE.PerspectiveCamera(45,1,.01,10000);
const controls=new OrbitControls(camera,canvas);
controls.enableDamping=true;
controls.screenSpacePanning=true;
const clock=new THREE.Clock();
let mixer=null,clips=[],activeAction=null,playing=false;
function clearVideoDownload(){
  if(videoObjectUrl){URL.revokeObjectURL(videoObjectUrl);videoObjectUrl=null;}
  videoSharedFile=null;videoDownload.hidden=true;videoDownload.removeAttribute('href');
  videoShare.hidden=true;
}
function configureVideoFormats(){
  const selectedMime=videoFormat.value;
  const formats=typeof HTMLCanvasElement!=='undefined'&&
    typeof HTMLCanvasElement.prototype.captureStream==='function'
    ?supportedVideoFormats():[];
  videoFormat.replaceChildren();
  for(const item of formats){
    const option=document.createElement('option');option.value=item.mimeType;
    option.textContent=item.label;videoFormat.append(option);
  }
  if(formats.some(item=>item.mimeType===selectedMime))videoFormat.value=selectedMime;
  const clipAvailable=Boolean(clips[Number(clipPicker.value)]?.duration>0);
  videoMode.querySelector('option[value="animation"]').disabled=!clipAvailable;
  if(!clipAvailable&&videoMode.value==='animation')videoMode.value='orbit';
  const isOrbit=videoMode.value==='orbit';
  videoDuration.disabled=!isOrbit;
  const duration=isOrbit?Number(videoDuration.value):clips[Number(clipPicker.value)]?.duration??0;
  videoFormat.disabled=!formats.length;
  videoStart.disabled=!modelLoaded||!formats.length||duration<=0||duration>MAX_VIDEO_SECONDS;
  videoStatus.textContent=!formats.length?'Den här webbläsaren saknar stöd för videoexport.':
    duration>MAX_VIDEO_SECONDS?'Animationen är för lång (max 120 sekunder).':
    videoResolution.value+'p · upp till 30 fps. Spelas in på enheten utan Modal.';
}
for(const control of [videoMode,videoDuration,videoResolution])
  control.addEventListener('change',()=>{clearVideoDownload();configureVideoFormats();});
videoFormat.addEventListener('change',clearVideoDownload);
const resize=()=>{
  const {width,height}=canvas.getBoundingClientRect();
  if(width<1||height<1)return;
  renderer.setSize(width,height,false);
  camera.aspect=width/height;camera.updateProjectionMatrix();
};
new ResizeObserver(resize).observe(canvas);
resize();
function chooseClip(index){
  if(!mixer||!clips[index])return;
  mixer.stopAllAction();
  activeAction=mixer.clipAction(clips[index]);
  activeAction.reset().setLoop(loopToggle.checked?THREE.LoopRepeat:THREE.LoopOnce,Infinity);
  activeAction.clampWhenFinished=true;
  playing=false;
  playButton.textContent='Spela';
  playButton.disabled=false;
  configureVideoFormats();
}
clipPicker.addEventListener('change',()=>chooseClip(Number(clipPicker.value)));
loopToggle.addEventListener('change',()=>{
  if(!activeAction)return;
  activeAction.setLoop(loopToggle.checked?THREE.LoopRepeat:THREE.LoopOnce,
    loopToggle.checked?Infinity:1);
});
playButton.addEventListener('click',()=>{
  if(!activeAction)return;
  if(playing){activeAction.paused=true;playing=false;}
  else{
    if(!activeAction.isRunning())activeAction.reset().play();
    activeAction.paused=false;playing=true;
  }
  playButton.textContent=playing?'Pausa':'Spela';
});
// Public video export remains local: no private API, upload or Modal request.
videoStart.addEventListener('click',()=>{
  const mode=videoMode.value;
  if(activeVideo||!modelLoaded||!['orbit','animation'].includes(mode))return;
  const selectedClip=clips[Number(clipPicker.value)];
  const duration=mode==='orbit'?Number(videoDuration.value):selectedClip?.duration??0;
  if(duration<=0||duration>MAX_VIDEO_SECONDS||
     (mode==='orbit'&&!ORBIT_DURATIONS.includes(duration))){
    videoStatus.textContent='Ogiltig videolängd.';return;
  }
  const mimeType=videoFormat.value;
  if(!supportedVideoFormats().some(item=>item.mimeType===mimeType)){
    videoStatus.textContent='Videoformatet stöds inte.';return;
  }
  const {width,height}=videoSize(videoResolution.value);
  clearVideoDownload();
  const wasPlaying=playing,wasTime=activeAction?.time??0;
  playing=false;playButton.textContent='Spela';
  const disabledState=[videoMode,videoDuration,videoResolution,videoFormat,
    clipPicker,playButton,loopToggle].map(control=>[control,control.disabled]);
  for(const [control] of disabledState)control.disabled=true;
  videoStart.disabled=true;videoCancel.hidden=false;
  const release=()=>{
    for(const [control,disabled] of disabledState)control.disabled=disabled;
    if(activeAction&&mixer){
      activeAction.reset().setLoop(loopToggle.checked?THREE.LoopRepeat:THREE.LoopOnce,
        loopToggle.checked?Infinity:1).play();
      mixer.setTime(wasTime);
      activeAction.paused=!wasPlaying;
    }
    playing=wasPlaying;playButton.textContent=playing?'Pausa':'Spela';
    activeVideo=null;videoCancel.hidden=true;
    configureVideoFormats();
  };
  try{
    if(mode==='animation'&&activeAction){
      activeAction.reset().setLoop(THREE.LoopOnce,1).play();
      activeAction.clampWhenFinished=true;
    }
    const controller=createViewerRecording({
      scene,sourceCamera:camera,sourceRenderer:renderer,target:controls.target,
      mode,durationSeconds:duration,mimeType,width,height,
      onFrame:seconds=>{if(mode==='animation')mixer?.setTime(seconds);},
      onProgress:(seconds,total)=>{
        videoStatus.textContent='Spelar in video: '+seconds.toFixed(1)+' / '+
          total.toFixed(1)+' s ('+videoResolution.value+'p)…';
      }
    });
    activeVideo={controller};
    controller.done.then(({blob,format})=>{
      videoObjectUrl=URL.createObjectURL(blob);
      const name=videoFileName('delad',mode==='orbit'?'360-rotation':
        selectedClip?.name||'animation',format);
      videoDownload.href=videoObjectUrl;videoDownload.download=name;videoDownload.hidden=false;
      try{
        if(typeof File==='function'){
          const file=new File([blob],name,{type:blob.type});
          if(typeof navigator.share==='function'&&navigator.canShare?.({files:[file]})){
            videoSharedFile=file;videoShare.hidden=false;
          }
        }
      }catch{/* Local save remains available. */}
      videoStatus.textContent='Videon är färdig ('+format.toUpperCase()+', '+
        videoResolution.value+'p).';
    }).catch(error=>{
      videoStatus.textContent=error instanceof VideoExportCancelled?
        'Videoexporten avbröts.':error instanceof Error?error.message:
        'Videoexporten misslyckades.';
    }).finally(()=>{
      const message=videoStatus.textContent;release();videoStatus.textContent=message;
    });
  }catch(error){
    release();videoStatus.textContent=error instanceof Error?error.message:
      'Videoinspelningen kunde inte startas.';
  }
});
videoCancel.addEventListener('click',()=>activeVideo?.controller.cancel());
videoShare.addEventListener('click',async()=>{
  if(!videoSharedFile||typeof navigator.share!=='function')return;
  try{await navigator.share({files:[videoSharedFile],title:'Delad Blender Workspace-video'});}
  catch(error){if(error?.name!=='AbortError')videoStatus.textContent=
    'Kunde inte dela videon. Välj Spara video i stället.';}
});

async function load(){
  try{
    const response=await fetch('/share/'+token+'/scene.glb',{
      credentials:'omit',cache:'no-store'});
    if(!response.ok)throw new Error('Delningen är inte längre tillgänglig.');
    const buffer=await response.arrayBuffer();
    const gltf=await new GLTFLoader().parseAsync(buffer,'');
    scene.add(gltf.scene);
    modelLoaded=true;
    const bounds=new THREE.Box3().setFromObject(gltf.scene);
    if(bounds.isEmpty())throw new Error('3D-modellen saknar synlig geometri.');
    const center=bounds.getCenter(new THREE.Vector3());
    const size=bounds.getSize(new THREE.Vector3());
    const radius=Math.max(size.length()/2,.1);
    const dist=radius/Math.tan(camera.fov*Math.PI/360)*1.6;
    camera.position.copy(center).add(new THREE.Vector3(dist*.75,dist*.55,dist));
    camera.near=Math.max(.001,dist/1000);
    camera.far=Math.max(1000,dist*30);
    camera.updateProjectionMatrix();
    controls.target.copy(center);controls.update();
    clips=gltf.animations;
    if(clips.length){
      mixer=new THREE.AnimationMixer(gltf.scene);
      clipPicker.replaceChildren();
      clips.forEach((clip,i)=>{
        const option=document.createElement('option');
        option.value=String(i);option.textContent=clip.name||'Animation '+(i+1);
        clipPicker.append(option);
      });
      clipPicker.disabled=false;
      animationControls.hidden=false;
      chooseClip(0);
    }
    configureVideoFormats();
    status.textContent='Modellen är redo. Rotera och zooma för att utforska.';
  }catch(error){
    status.textContent=error instanceof Error?error.message:'Kunde inte läsa modellen.';
  }
}
let active=true;
function frame(){
  if(!active)return;
  requestAnimationFrame(frame);
  const delta=Math.min(clock.getDelta(),.1);
  if(playing&&mixer)mixer.update(delta);
  controls.update();renderer.render(scene,camera);
}
window.addEventListener('pagehide',()=>{
  activeVideo?.controller.cancel();clearVideoDownload();
  active=false;controls.dispose();renderer.dispose();
});
void load();frame();
