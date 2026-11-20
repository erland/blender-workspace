import * as THREE from 'three';

/** Local, deterministic GLB clip playback. No server-side animation jobs. */
export class ClipPlayer {
  constructor(model,clips=[]){
    this.mixer=new THREE.AnimationMixer(model);
    this.clips=clips.filter(clip=>clip instanceof THREE.AnimationClip &&
      Number.isFinite(clip.duration)&&clip.duration>0&&clip.tracks.length>0);
    this.action=null;
    this.clip=null;
    this.currentTime=0;
  }
  get names(){return this.clips.map((clip,index)=>({index,name:clip.name||'Animation '+(index+1)}));}
  get duration(){return this.clip?.duration??0;}
  select(index){
    if(!Number.isInteger(index)||index<0||index>=this.clips.length){
      this.action?.stop();
      this.action=null;this.clip=null;this.currentTime=0;
      return false;
    }
    this.action?.stop();
    this.clip=this.clips[index];
    this.action=this.mixer.clipAction(this.clip);
    this.action.reset().setLoop(THREE.LoopOnce,1).play();
    this.action.clampWhenFinished=true;
    this.seek(0);
    return true;
  }
  seek(seconds){
    if(!this.action||!Number.isFinite(seconds))return;
    this.currentTime=Math.max(0,Math.min(seconds,this.duration));
    // setTime updates bones, transforms and morph targets at an absolute time.
    // No mixer.update occurs, so playback is controlled exclusively by the UI.
    this.action.reset().setLoop(THREE.LoopOnce,1).play();
    this.action.clampWhenFinished=true;
    this.mixer.setTime(this.currentTime);
  }
  dispose(){
    this.action?.stop();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
    this.action=null;this.clip=null;this.clips=[];
  }
}
