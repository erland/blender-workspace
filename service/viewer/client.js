import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// Read-only same-origin GLB viewer; no user code, access tokens or Modal calls.
const match=location.pathname.match(/^\/viewer\/([0-9a-f-]{36})\/revisions\/([1-9][0-9]{0,7})$/i);
if(!match)throw new Error('Invalid viewer URL');
const [,projectId,revision]=match;
const status=document.getElementById('status');
const selected=document.getElementById('selected');
const comparison=document.getElementById('comparison');
const revisionPicker=document.getElementById('revision-picker');
const comparePane=document.getElementById('compare-pane');
const copyButton=document.getElementById('copy-selection');
const getGlbUrl=r=>'/viewer/api/projects/'+projectId+'/revisions/'+r+'/scene.glb';
const getRevisionsUrl=()=>'/viewer/api/projects/'+projectId+'/revisions';
const loader=new GLTFLoader();
const raycaster=new THREE.Raycaster();
const pointer=new THREE.Vector2();
let active=true;

function createViewport(canvas,interactive=false){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  const scene=new THREE.Scene();
  scene.background=new THREE.Color(0xf1f4f8);
  scene.add(new THREE.HemisphereLight(0xffffff,0x94a3b8,2.4));
  const light=new THREE.DirectionalLight(0xffffff,2);
  light.position.set(3,7,5);
  scene.add(light);
  const camera=new THREE.PerspectiveCamera(45,1,0.001,10000);
  const controls=new OrbitControls(camera,canvas);
  controls.enableDamping=true;
  controls.screenSpacePanning=true;
  const state={renderer,scene,camera,controls,canvas,model:null,bounds:null,selectionHelper:null};
  const resize=()=>{
    const rect=canvas.getBoundingClientRect();
    const w=Math.max(1,Math.round(rect.width)),h=Math.max(1,Math.round(rect.height));
    renderer.setSize(w,h,false);
    camera.aspect=w/h;
    camera.updateProjectionMatrix();
  };
  const observer=new ResizeObserver(resize);
  observer.observe(canvas);resize();
  function fit(){
    if(!state.bounds)return;
    const center=state.bounds.getCenter(new THREE.Vector3());
    const radius=Math.max(state.bounds.getSize(new THREE.Vector3()).length()/2,.01);
    const distance=radius/Math.sin(THREE.MathUtils.degToRad(camera.fov/2))*1.35;
    camera.near=Math.max(distance/1000,.001);
    camera.far=distance*1000;
    camera.position.copy(center).add(new THREE.Vector3(distance*.75,distance*.55,distance));
    camera.lookAt(center);
    controls.target.copy(center);
    controls.minDistance=Math.max(radius*.02,.001);
    controls.maxDistance=Math.max(radius*100,10);
    camera.updateProjectionMatrix();controls.update();
  }
  function clear(){
    if(state.selectionHelper){scene.remove(state.selectionHelper);state.selectionHelper.geometry.dispose();state.selectionHelper.material.dispose();state.selectionHelper=null;}
    if(state.model){scene.remove(state.model);state.model=null;}
    state.bounds=null;
  }
  function draw(){
    if(!active)return;
    requestAnimationFrame(draw);
    if(!canvas.closest('[hidden]')){controls.update();renderer.render(scene,camera);}
  }
  draw();
  return Object.assign(state,{fit,clear,dispose:()=>{observer.disconnect();controls.dispose();clear();renderer.dispose();}});
}
const main=createViewport(document.getElementById('viewport'),true);
const secondary=createViewport(document.getElementById('comparison-viewport'));

async function load(rev,viewport){
  const response=await fetch(getGlbUrl(rev),{
    credentials:'same-origin',cache:'no-store',headers:{accept:'model/gltf-binary'}});
  if(!response.ok)throw new Error(response.status===401?'Logga in för att visa modellen':'GLB kunde inte hämtas ('+response.status+')');
  const buffer=await response.arrayBuffer();
  const gltf=await loader.parseAsync(buffer,'');
  const model=gltf.scene;
  const bounds=new THREE.Box3().setFromObject(model);
  if(bounds.isEmpty())throw new Error('Revision '+rev+' saknar synlig geometri');
  viewport.clear();
  viewport.model=model;
  viewport.bounds=bounds;
  viewport.scene.add(model);
  viewport.fit();
}
function selectedIdentity(hit){
  // Blender custom properties are exported as glTF node extras by DEV-022.
  // GLTFLoader maps glTF extras into Object3D.userData.
  let obj=hit;
  while(obj&&obj!==main.model){
    const id=obj.userData?.bw_object_id;
    if(typeof id==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
      return {name:obj.name||hit.name||'Namnlöst objekt',id};
    obj=obj.parent;
  }
  // Older revisions have names only; do not invent an ID.
  obj=hit;
  while(obj&&obj!==main.model){
    if(obj.name?.trim())return {name:obj.name,id:null};
    obj=obj.parent;
  }
  return {name:hit.name||'Namnlöst objekt',id:null};
}
let chosen=null;
function clearSelection(){
  chosen=null;
  selected.textContent='Inget objekt markerat';
  copyButton.disabled=true;
  if(main.selectionHelper){
    main.scene.remove(main.selectionHelper);
    main.selectionHelper.geometry.dispose();
    main.selectionHelper.material.dispose();
    main.selectionHelper=null;
  }
}
let pointerDown=null;
main.canvas.addEventListener('pointerdown',event=>{
  pointerDown={x:event.clientX,y:event.clientY};
});
main.canvas.addEventListener('pointerup',event=>{
  if(!main.model||!pointerDown)return;
  const moved=Math.hypot(event.clientX-pointerDown.x,event.clientY-pointerDown.y);
  pointerDown=null;
  if(moved>6)return; // Orbit or pan gesture: do not change selection.
  const rect=main.canvas.getBoundingClientRect();
  pointer.set((event.clientX-rect.left)/rect.width*2-1,
    -(event.clientY-rect.top)/rect.height*2+1);
  raycaster.setFromCamera(pointer,main.camera);
  const hits=raycaster.intersectObject(main.model,true).filter(hit=>hit.object.isMesh);
  clearSelection();
  if(!hits.length)return;
  const obj=hits[0].object;
  chosen=selectedIdentity(obj);
  selected.textContent='Markerat objekt: '+chosen.name+
    (chosen.id?' (ID: '+chosen.id+')':' (äldre revision: saknar stabilt ID)');
  copyButton.disabled=false;
  main.selectionHelper=new THREE.BoxHelper(obj,0x2563eb);
  main.scene.add(main.selectionHelper);
});
main.canvas.addEventListener('pointercancel',()=>{pointerDown=null;});
copyButton.addEventListener('click',async()=>{
  if(!chosen)return;
  const reference='Projekt '+projectId+', revision '+revision+', objekt "'+chosen.name+'"'+
    (chosen.id?', objekt-ID '+chosen.id:' (äldre revision utan objekt-ID)');
  try{await navigator.clipboard.writeText(reference);status.textContent='Objektreferens kopierad';}
  catch{status.textContent='Kunde inte kopiera objektreferensen';}
});
document.getElementById('reset').addEventListener('click',()=>{main.fit();secondary.fit();});
document.getElementById('snapshot').addEventListener('click',()=>{
  main.renderer.render(main.scene,main.camera);
  main.canvas.toBlob(blob=>{
    if(!blob){status.textContent='Kunde inte skapa bild';return;}
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='blender-workspace-r'+revision+'.png';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  },'image/png');
});
revisionPicker.addEventListener('change',async()=>{
  const rev=revisionPicker.value;
  if(!rev){comparePane.hidden=true;secondary.clear();comparison.textContent='Ingen jämförelse';return;}
  try{
    comparison.textContent='Laddar revision '+rev+'…';
    comparePane.hidden=false;
    await load(rev,secondary);
    comparison.textContent='Jämför revision '+revision+' med '+rev;
  }catch{
    secondary.clear();comparePane.hidden=true;
    comparison.textContent='Kunde inte visa jämförelserevisionen';
    revisionPicker.value='';
  }
});
try{
  await load(revision,main);
  document.getElementById('reset').disabled=false;
  document.getElementById('snapshot').disabled=false;
  status.textContent='Revision '+revision+' – klicka på ett objekt, dra för att rotera';
  try{
    const response=await fetch(getRevisionsUrl(),{credentials:'same-origin',cache:'no-store'});
    if(response.ok){
      const data=await response.json();
      for(const rev of data.revisions.filter(n=>Number.isInteger(n)&&n>0&&String(n)!==revision)){
        const option=document.createElement('option');
        option.value=String(rev);option.textContent='Revision '+rev;
        revisionPicker.append(option);
      }
      revisionPicker.disabled=revisionPicker.options.length===1;
    }
  }catch{comparison.textContent='Revisionslistan kunde inte hämtas';}
}catch(err){status.textContent=err instanceof Error?err.message:'Modellen kunde inte öppnas';}
window.addEventListener('pagehide',()=>{active=false;main.dispose();secondary.dispose();});
