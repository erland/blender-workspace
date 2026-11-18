import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// DEV-019: all model bytes come from the same-origin, authenticated GLB route.
// No OAuth tokens, user-provided scripts, remote asset URLs or Modal calls.
const canvas=document.getElementById('viewport');
const message=document.getElementById('status');
const reset=document.getElementById('reset');
const snapshot=document.getElementById('snapshot');
const match=location.pathname.match(/^\/viewer\/([0-9a-f-]{36})\/revisions\/([1-9][0-9]{0,7})$/i);
if(!match)throw new Error('Invalid viewer URL');
const [,projectId,revision]=match;
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
const scene=new THREE.Scene();
scene.background=new THREE.Color(0xf1f4f8);
scene.add(new THREE.HemisphereLight(0xffffff,0x94a3b8,2.4));
const light=new THREE.DirectionalLight(0xffffff,2);
light.position.set(3,7,5);
scene.add(light);
const camera=new THREE.PerspectiveCamera(45,1,0.01,10000);
const controls=new OrbitControls(camera,canvas);
controls.enableDamping=true;
controls.screenSpacePanning=true;
controls.minDistance=0.01;
controls.maxDistance=100000;
let bounds,model;
function fit(){
  if(!bounds)return;
  const center=bounds.getCenter(new THREE.Vector3());
  const size=bounds.getSize(new THREE.Vector3());
  const radius=Math.max(size.length()/2,0.01);
  const distance=radius/Math.sin(THREE.MathUtils.degToRad(camera.fov/2))*1.35;
  camera.near=Math.max(distance/1000,0.001);
  camera.far=distance*1000;
  camera.position.copy(center).add(new THREE.Vector3(distance*0.75,distance*0.55,distance));
  camera.lookAt(center);
  controls.target.copy(center);
  controls.minDistance=Math.max(radius*0.02,0.001);
  controls.maxDistance=Math.max(radius*100,10);
  camera.updateProjectionMatrix();
  controls.update();
}
reset.addEventListener('click',fit);
snapshot.addEventListener('click',()=>{
  renderer.render(scene,camera);
  canvas.toBlob(blob=>{
    if(!blob){message.textContent='Kunde inte skapa en bild';return;}
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;link.download='blender-workspace-r'+revision+'.png';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  },'image/png');
});
function resize(){
  const rect=canvas.getBoundingClientRect();
  const w=Math.max(1,Math.round(rect.width)),h=Math.max(1,Math.round(rect.height));
  renderer.setSize(w,h,false);
  camera.aspect=w/h;camera.updateProjectionMatrix();
}
const observer=new ResizeObserver(resize);observer.observe(canvas);
resize();
let active=true;
function animate(){
  if(!active)return;
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene,camera);
}
animate();
try{
  const response=await fetch('/viewer/api/projects/'+projectId+'/revisions/'+revision+'/scene.glb',{
    credentials:'same-origin',cache:'no-store',headers:{accept:'model/gltf-binary'}
  });
  if(!response.ok)throw new Error(response.status===401?'Logga in för att visa modellen':'Modellen kunde inte hämtas ('+response.status+')');
  const bytes=await response.arrayBuffer();
  const gltf=await new GLTFLoader().parseAsync(bytes,'');
  model=gltf.scene;
  scene.add(model);
  bounds=new THREE.Box3().setFromObject(model);
  if(bounds.isEmpty())throw new Error('Modellen innehåller ingen synlig geometri');
  fit();
  reset.disabled=false;snapshot.disabled=false;
  message.textContent='Revision '+revision+' – dra för att rotera, scrolla för att zooma';
}catch(error){
  message.textContent=error instanceof Error?error.message:'Modellen kunde inte öppnas';
}
window.addEventListener('pagehide',()=>{
  active=false;observer.disconnect();controls.dispose();renderer.dispose();
});
