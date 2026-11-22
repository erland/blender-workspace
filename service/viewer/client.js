import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {cameraPlacement,DEFAULT_VIEW,VIEW_DIRECTIONS} from './view-controls.js';
import {resizeViewportProjection} from './viewport-resize.js';
import {ClipPlayer} from './clip-player.js';
import {supportedVideoFormats,VIDEO_WIDTH,VIDEO_HEIGHT,MAX_VIDEO_SECONDS,
  recordCanvasClip,videoFileName,VideoExportCancelled} from './video-export.js';

// Read-only same-origin GLB viewer; no user code, access tokens or Modal calls.
const match=location.pathname.match(/^\/viewer\/([0-9a-f-]{36})\/revisions\/([1-9][0-9]{0,7})$/i);
if(!match)throw new Error('Invalid viewer URL');
const [,projectId,revision]=match;
const status=document.getElementById('status');
const selected=document.getElementById('selected');
const selectionBar=document.getElementById('selection-bar');
const comparison=document.getElementById('comparison');
const revisionPicker=document.getElementById('revision-picker');
const comparePane=document.getElementById('compare-pane');
const copyButton=document.getElementById('copy-selection');
const viewPicker=document.getElementById('view-angle');
const boundsToggle=document.getElementById('show-bounds');
const axesToggle=document.getElementById('show-axes');
const wireframeToggle=document.getElementById('show-wireframe');
const animationBar=document.getElementById('animation-bar');
const animationPicker=document.getElementById('animation-clip');
const animationPlay=document.getElementById('animation-play');
const animationSeek=document.getElementById('animation-seek');
const animationClock=document.getElementById('animation-clock');
const animationLoopToggle=document.getElementById('animation-loop');
const videoFormat=document.getElementById('video-format');
const videoStart=document.getElementById('video-start');
const videoCancel=document.getElementById('video-cancel');
const videoDownload=document.getElementById('video-download');
const videoShare=document.getElementById('video-share');
const videoStatus=document.getElementById('video-status');
let activeVideo=null,videoObjectUrl=null,videoSharedFile=null;
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
    const option=document.createElement('option');
    option.value=item.mimeType;option.textContent=item.label;
    videoFormat.append(option);
  }
  if(formats.some(f=>f.mimeType===selectedMime))videoFormat.value=selectedMime;
  const duration=main.animation?.duration??0;
  const supported=formats.length>0&&duration>0&&duration<=MAX_VIDEO_SECONDS;
  videoFormat.disabled=!supported;
  videoStart.disabled=!supported;
  if(!formats.length)videoStatus.textContent=
    'Den här webbläsaren kan inte spela in MP4 eller WebM från 3D-visaren.';
  else if(duration>MAX_VIDEO_SECONDS)videoStatus.textContent=
    'Animationen är för lång (max 120 sekunder för videoexport).';
  else videoStatus.textContent='720p · upp till 30 fps. Spelas in i realtid på enheten, utan Modal.';
}
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
  const state={renderer,scene,camera,controls,canvas,model:null,bounds:null,
    selectionHelper:null,boundsHelper:null,axesHelper:null,wireframeMaterials:new Map(),animation:null,
    viewAngle:DEFAULT_VIEW,showBounds:false,showAxes:false,showWireframe:false};
  const resize=()=>{
    const rect=canvas.getBoundingClientRect();
    // Only update viewport dimensions; never reset the saved user orbit,
    // pan or zoom when the iPad rotates or comparison layout changes.
    resizeViewportProjection(renderer,camera,rect.width,rect.height);
  };
  const observer=new ResizeObserver(resize);
  observer.observe(canvas);resize();
  function orient(view=DEFAULT_VIEW){
    if(!(view in VIEW_DIRECTIONS))throw new RangeError('Unknown camera preset');
    state.viewAngle=view;
    if(!state.bounds)return;
    const framing=cameraPlacement(state.bounds,view,camera.aspect,camera.fov);
    camera.up.copy(framing.up);
    camera.position.copy(framing.position);
    camera.near=framing.near;
    camera.far=framing.far;
    camera.lookAt(framing.center);
    controls.target.copy(framing.center);
    controls.minDistance=framing.minDistance;
    controls.maxDistance=framing.maxDistance;
    camera.updateProjectionMatrix();
    controls.update();
  }
  function fit(){orient(state.viewAngle);}
  function clearHints(){
    for(const helper of [state.boundsHelper,state.axesHelper]){
      if(!helper)continue;
      scene.remove(helper);
      helper.geometry.dispose();
      if(Array.isArray(helper.material))helper.material.forEach(m=>m.dispose());
      else helper.material.dispose();
    }
    state.boundsHelper=null;
    state.axesHelper=null;
    for(const [material,wasWireframe] of state.wireframeMaterials){
      material.wireframe=wasWireframe;
      material.needsUpdate=true;
    }
    state.wireframeMaterials.clear();
  }
  function setHints({bounds=state.showBounds,axes=state.showAxes,wireframe=state.showWireframe}={}){
    state.showBounds=Boolean(bounds);
    state.showAxes=Boolean(axes);
    state.showWireframe=Boolean(wireframe);
    clearHints();
    if(!state.model||!state.bounds)return;
    if(state.showBounds){
      state.boundsHelper=new THREE.Box3Helper(state.bounds.clone(),0xf59e0b);
      scene.add(state.boundsHelper);
    }
    if(state.showAxes){
      const size=Math.max(0.1,state.bounds.getSize(new THREE.Vector3()).length()/3);
      state.axesHelper=new THREE.AxesHelper(size);
      scene.add(state.axesHelper);
    }
    if(state.showWireframe){
      state.model.traverse(obj=>{
        if(!obj.isMesh)return;
        const materials=Array.isArray(obj.material)?obj.material:[obj.material];
        for(const material of materials){
          if(!material||typeof material.wireframe!=='boolean')continue;
          if(!state.wireframeMaterials.has(material))
            state.wireframeMaterials.set(material,material.wireframe);
          material.wireframe=true;
          material.needsUpdate=true;
        }
      });
    }
  }
  function clear(){
    if(state.animation){state.animation.dispose();state.animation=null;}
    clearHints();
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
  function setAnimations(model,clips){
    state.animation?.dispose();
    state.animation=new ClipPlayer(model,clips);
  }
  function seekAnimation(seconds){
    state.animation?.seek(seconds);
    state.selectionHelper?.update();
  }
  return Object.assign(state,{fit,orient,setHints,clear,setAnimations,seekAnimation,
    dispose:()=>{observer.disconnect();controls.dispose();clear();renderer.dispose();}});
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
  viewport.setAnimations(model,gltf.animations);
  viewport.scene.add(model);
  viewport.fit();
  viewport.setHints();
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
  selectionBar.hidden=true;
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
  selectionBar.hidden=false;
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
viewPicker.addEventListener('change',()=>{
  const view=viewPicker.value;
  if(!(view in VIEW_DIRECTIONS))return;
  main.orient(view);
  secondary.orient(view);
});
function syncHints(){
  const hints={bounds:boundsToggle.checked,axes:axesToggle.checked,
    wireframe:wireframeToggle.checked};
  main.setHints(hints);
  secondary.setHints(hints);
}
for(const toggle of [boundsToggle,axesToggle,wireframeToggle])
  toggle.addEventListener('change',syncHints);
document.getElementById('snapshot').addEventListener('click',()=>{
  main.renderer.render(main.scene,main.camera);
  main.canvas.toBlob(blob=>{
    if(!blob){status.textContent='Kunde inte skapa bild';return;}
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='blender-workspace-r'+revision+'-'+main.viewAngle+'.png';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  },'image/png');
});
// The transport is shared across normal and comparison views. A comparison
// revision follows the selected clip only when it has the same clip name.
let animationTime=0,animationPlaying=false,animationLastFrame=null;
const formatTime=time=>Number.isFinite(time)?time.toFixed(1)+' s':'0.0 s';
function selectedAnimationName(){
  return main.animation?.names[Number(animationPicker.value)]?.name??null;
}
function selectComparisonClip(){
  const name=selectedAnimationName();
  const index=secondary.animation?.names.find(item=>item.name===name)?.index;
  secondary.animation?.select(index??-1);
}
function applyAnimationTime(){
  main.seekAnimation(animationTime);
  const primaryDuration=main.animation?.duration??0;
  const comparisonDuration=secondary.animation?.duration??0;
  if(primaryDuration>0&&comparisonDuration>0)
    secondary.seekAnimation(animationTime/primaryDuration*comparisonDuration);
  animationSeek.value=String(primaryDuration?Math.round(1000*animationTime/primaryDuration):0);
  animationClock.textContent=formatTime(animationTime)+' / '+formatTime(primaryDuration);
  animationPlay.textContent=animationPlaying?'Pausa':'Spela';
  animationPlay.setAttribute('aria-label',animationPlaying?'Pausa animation':'Spela animation');
}
function selectAnimation(index){
  clearVideoDownload();
  animationPlaying=false;animationTime=0;
  main.animation?.select(index);
  selectComparisonClip();applyAnimationTime();
}
function configureAnimationControls(){
  animationPicker.replaceChildren();
  const clips=main.animation?.names??[];
  animationBar.hidden=clips.length===0;
  if(!clips.length){animationPlaying=false;configureVideoFormats();return;}
  for(const clip of clips){
    const option=document.createElement('option');
    option.value=String(clip.index);option.textContent=clip.name;
    animationPicker.append(option);
  }
  animationPicker.value='0';selectAnimation(0);
  configureVideoFormats();
}
animationPicker.addEventListener('change',()=>selectAnimation(Number(animationPicker.value)));
animationPlay.addEventListener('click',()=>{
  if(!main.animation?.duration)return;
  if(!animationPlaying&&animationTime>=main.animation.duration)animationTime=0;
  animationPlaying=!animationPlaying;applyAnimationTime();
});
animationSeek.addEventListener('input',()=>{
  const duration=main.animation?.duration??0;
  if(!duration)return;
  animationTime=duration*Number(animationSeek.value)/1000;
  applyAnimationTime();
});
function animationFrame(now){
  if(!active)return;
  const elapsed=animationLastFrame===null?0:(now-animationLastFrame)/1000;
  animationLastFrame=now;
  if(animationPlaying&&!document.hidden){
    const duration=main.animation?.duration??0;
    if(duration>0){
      // Ignore unusually long gaps (background tab, device suspension).
      animationTime+=elapsed>0&&elapsed<0.5?elapsed:0;
      if(animationTime>=duration){
        if(animationLoopToggle.checked)animationTime%=duration;
        else{animationTime=duration;animationPlaying=false;}
      }
      applyAnimationTime();
    }
  }
  requestAnimationFrame(animationFrame);
}
requestAnimationFrame(animationFrame);

// Video export deliberately records the selected clip from 0 to its end,
// once, with the camera frozen at export start. No Python, server request or
// Modal job is involved. Separate GPU canvas preserves the live viewer size.
const exportControls=()=>[
  animationPicker,animationPlay,animationSeek,animationLoopToggle,
  revisionPicker,viewPicker,boundsToggle,axesToggle,wireframeToggle,
  document.getElementById('reset'),document.getElementById('snapshot'),
  document.getElementById('render-current-view')
];
videoFormat.addEventListener('change',clearVideoDownload);
videoStart.addEventListener('click',()=>{
  if(activeVideo||!main.model||!main.animation?.duration)return;
  const duration=main.animation.duration;
  if(duration>MAX_VIDEO_SECONDS){
    videoStatus.textContent='Animationen är för lång (max 120 sekunder).';return;
  }
  const mimeType=videoFormat.value;
  const format=supportedVideoFormats().find(item=>item.mimeType===mimeType);
  if(!format){
    videoStatus.textContent='Det valda videoformatet stöds inte på denna enhet.';return;
  }
  clearVideoDownload();
  const beforeTime=animationTime;
  animationPlaying=false;animationLastFrame=null;applyAnimationTime();
  const disabledState=exportControls().map(control=>[control,control.disabled]);
  for(const [control] of disabledState)control.disabled=true;
  videoFormat.disabled=true;videoStart.disabled=true;
  videoCancel.hidden=false;
  let canvas=null,renderer=null,controller=null;
  const release=()=>{
    try{renderer?.dispose();renderer?.forceContextLoss();}catch{}
    canvas?.remove();
    for(const [control,disabled] of disabledState)control.disabled=disabled;
    videoCancel.hidden=true;
    activeVideo=null;
    animationTime=beforeTime;animationLastFrame=null;applyAnimationTime();
    configureVideoFormats();
  };
  try{
    canvas=document.createElement('canvas');
    canvas.width=VIDEO_WIDTH;canvas.height=VIDEO_HEIGHT;
    canvas.setAttribute('aria-hidden','true');
    canvas.style.cssText='position:fixed;left:-10000px;top:0;width:1px;height:1px;pointer-events:none';
    document.body.append(canvas);
    renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
    renderer.setPixelRatio(1);
    renderer.setSize(VIDEO_WIDTH,VIDEO_HEIGHT,false);
    renderer.outputColorSpace=main.renderer.outputColorSpace;
    renderer.toneMapping=main.renderer.toneMapping;
    const camera=main.camera.clone();
    camera.aspect=VIDEO_WIDTH/VIDEO_HEIGHT;
    camera.updateProjectionMatrix();
    const drawFrame=seconds=>{
      animationTime=seconds;
      applyAnimationTime();
      renderer.render(main.scene,camera);
    };
    // First frame is drawn before recording begins; recorder.start remains
    // directly inside the click handler for Safari/iPad gesture restrictions.
    drawFrame(0);
    controller=recordCanvasClip({canvas,durationSeconds:duration,mimeType,drawFrame,
      onProgress:(seconds,total)=>{
        videoStatus.textContent='Spelar in video: '+seconds.toFixed(1)+' / '+
          total.toFixed(1)+' s (720p, 30 fps målvärde)…';
      }});
    activeVideo={controller};
    controller.done.then(({blob,format:recordedFormat})=>{
      videoObjectUrl=URL.createObjectURL(blob);
      const filename=videoFileName(revision,selectedAnimationName(),recordedFormat);
      videoDownload.href=videoObjectUrl;videoDownload.download=filename;
      videoDownload.hidden=false;
      // Optional platform sharing must never invalidate a completed download.
      try{
        if(typeof File==='function'){
          const file=new File([blob],filename,{type:blob.type});
          if(typeof navigator.share==='function'&&
             navigator.canShare?.({files:[file]})){
            videoSharedFile=file;videoShare.hidden=false;
          }
        }
      }catch{/* Download via the local Blob URL remains available. */}
      videoStatus.textContent='Videon är färdig ('+recordedFormat.toUpperCase()+
        ', 720p). Välj Spara video eller Dela video.';
    }).catch(error=>{
      videoStatus.textContent=error instanceof VideoExportCancelled
        ?'Videoexporten avbröts.'
        :error instanceof Error?error.message:'Det gick inte att exportera videon.';
    }).finally(()=>{
      // Only release GPU resources; keep the generated Blob URL available
      // until another clip/export is selected or the tab is closed.
      const message=videoStatus.textContent;
      release();
      videoStatus.textContent=message;
    });
  }catch{
    release();
    videoStatus.textContent='Videoinspelning kunde inte startas på den här enheten.';
  }
});
videoCancel.addEventListener('click',()=>activeVideo?.controller.cancel());
videoShare.addEventListener('click',async()=>{
  if(!videoSharedFile||typeof navigator.share!=='function')return;
  try{await navigator.share({files:[videoSharedFile],title:'Blender Workspace-animation'});}
  catch(error){
    if(error?.name!=='AbortError')videoStatus.textContent=
      'Kunde inte dela videon. Använd Spara video i stället.';
  }
});
revisionPicker.addEventListener('change',async()=>{
  const rev=revisionPicker.value;
  if(!rev){comparePane.hidden=true;secondary.clear();comparison.textContent='Ingen jämförelse';return;}
  try{
    comparison.textContent='Laddar revision '+rev+'…';
    comparePane.hidden=false;
    await load(rev,secondary);
    selectComparisonClip();applyAnimationTime();
    comparison.textContent='Jämför revision '+revision+' med '+rev;
  }catch{
    secondary.clear();comparePane.hidden=true;
    comparison.textContent='Kunde inte visa jämförelserevisionen';
    revisionPicker.value='';
  }
});
const renderButton=document.getElementById('render-current-view');
const renderMessage=document.getElementById('render-status');
const renderGallery=document.getElementById('render-history');
const showAllButton=document.getElementById('render-show-all');
const renderApi='/viewer/api/projects/'+projectId+'/revisions/'+revision+'/renders';
let renderCsrf=null, renderEntries=[],showAllRenders=false,renderRefresh=null;
function showRenderHistory(){
  renderGallery.replaceChildren();
  const completed=renderEntries.filter(j=>j.status==='completed'&&j.imageUrl);
  const activeJobs=renderEntries.filter(j=>j.status==='pending'||j.status==='running');
  const recoverable=renderEntries.filter(j=>j.status==='needs_recovery');
  renderMessage.textContent=activeJobs.length
    ?activeJobs.length+' rendering(ar) i kö eller under körning. Status uppdateras automatiskt.'
    :recoverable.length
      ?'Ett renderjobb kräver åtgärd. Se Jobb för information.'
      :completed.length?completed.length+' sparade bilder för revision '+revision:
        'Inga färdiga renderingar för denna revision.';
  for(const job of completed.slice(0,showAllRenders?50:3)){
    // Render URLs are generated on our own server, never provided by the user.
    if(!/^\/renders\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/i.test(job.imageUrl))continue;
    const item=document.createElement('div');
    item.className='render-card';
    const link=document.createElement('a');
    link.href=job.imageUrl;link.target='_blank';link.rel='noopener';
    const img=document.createElement('img');
    img.src=job.imageUrl;img.alt='Rendering för revision '+revision;
    img.loading='lazy';
    link.append(img);item.append(link);
    const details=document.createElement('small');
    details.textContent=(job.engine==='CYCLES'?'Cycles':'Eevee')+' · '+
      job.width+' × '+job.height+' · '+job.samples+' samples';
    item.append(details);renderGallery.append(item);
  }
  showAllButton.hidden=completed.length<=3;
  showAllButton.textContent=showAllRenders?'Visa färre bilder':'Visa alla '+completed.length+' bilder';
  if(activeJobs.length&&!renderRefresh)
    renderRefresh=setInterval(()=>{if(!document.hidden)void refreshRenderHistory();},10000);
  if(!activeJobs.length&&renderRefresh){clearInterval(renderRefresh);renderRefresh=null;}
}
async function refreshRenderHistory(){
  try{
    const response=await fetch(renderApi,{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw new Error('Renderingshistorik kunde inte hämtas');
    const data=await response.json();
    if(typeof data.csrf!=='string'||!Array.isArray(data.renders))throw new Error('Invalid render history');
    renderCsrf=data.csrf;renderEntries=data.renders;
    showRenderHistory();
  }catch{renderMessage.textContent='Renderingshistorik kunde inte hämtas. Försök ladda om sidan.';}
}
showAllButton.addEventListener('click',()=>{showAllRenders=!showAllRenders;showRenderHistory();});
renderButton.addEventListener('click',async()=>{
  if(!main.model||!renderCsrf||renderButton.disabled)return;
  const rect=main.canvas.getBoundingClientRect();
  if(!Number.isFinite(rect.width)||!Number.isFinite(rect.height)||rect.width<=0||
     rect.height<=0||rect.width/rect.height>4||rect.width/rect.height<0.25){
    renderMessage.textContent='Visarens bildförhållande kan inte renderas.';return;
  }
  if(!confirm('Starta Cycles-rendering från denna vy? Jobbet körs i ditt Modal-konto och kan kosta pengar.'))return;
  const worldUp=new THREE.Vector3(0,1,0).applyQuaternion(main.camera.quaternion);
  const camera={
    type:'perspective',position:main.camera.position.toArray(),
    target:main.controls.target.toArray(),up:worldUp.toArray(),
    verticalFovDegrees:main.camera.fov
  };
  renderButton.disabled=true;
  renderMessage.textContent='Beställer rendering…';
  try{
    const response=await fetch(renderApi,{method:'POST',credentials:'same-origin',
      headers:{'content-type':'application/json','x-csrf-token':renderCsrf},
      body:JSON.stringify({camera,viewportWidth:rect.width,viewportHeight:rect.height})});
    if(!response.ok)throw new Error(response.status===409?'Anslut ditt Modal-konto i Inställningar.':
      response.status===422?'Ogiltigt kameraläge eller ett annat renderjobb pågår.':
      'Renderingen kunde inte beställas.');
    await refreshRenderHistory();
  }catch(error){renderMessage.textContent=error instanceof Error?error.message:'Kunde inte starta rendering';}
  finally{renderButton.disabled=false;}
});
try{
  await load(revision,main);
  configureAnimationControls();
  document.getElementById('reset').disabled=false;
  document.getElementById('snapshot').disabled=false;
  renderButton.disabled=false;
  void refreshRenderHistory();
  viewPicker.disabled=false;
  for(const toggle of [boundsToggle,axesToggle,wireframeToggle])toggle.disabled=false;
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
window.addEventListener('pagehide',()=>{activeVideo?.controller.cancel();clearVideoDownload();if(renderRefresh)clearInterval(renderRefresh);active=false;main.dispose();secondary.dispose();});
