import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

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
async function load(){
  try{
    const response=await fetch('/share/'+token+'/scene.glb',{
      credentials:'omit',cache:'no-store'});
    if(!response.ok)throw new Error('Delningen är inte längre tillgänglig.');
    const buffer=await response.arrayBuffer();
    const gltf=await new GLTFLoader().parseAsync(buffer,'');
    scene.add(gltf.scene);
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
  active=false;controls.dispose();renderer.dispose();
});
void load();frame();
