/** Deterministic 360-degree camera orbit used by both GLB viewers. */
export const VIDEO_RESOLUTIONS=Object.freeze({'720':Object.freeze({width:1280,height:720}),
  '1080':Object.freeze({width:1920,height:1080})});
export const ORBIT_DURATIONS=Object.freeze([10,15,30,60]);
export function videoSize(value){
  const size=VIDEO_RESOLUTIONS[String(value)];
  if(!size)throw new RangeError('Ogiltig videoupplösning.');
  return size;
}
export function orbitPosition(start,target,seconds,duration){
  if(!Array.isArray(start)||!Array.isArray(target)||start.length!==3||target.length!==3||
     ![...start,...target,seconds,duration].every(Number.isFinite)||
     !ORBIT_DURATIONS.includes(duration))
    throw new RangeError('Ogiltiga kameravärden för 360°-rotation.');
  const phase=Math.max(0,Math.min(1,seconds/duration))*Math.PI*2;
  const dx=start[0]-target[0],dz=start[2]-target[2];
  return [target[0]+dx*Math.cos(phase)-dz*Math.sin(phase),
    start[1],target[2]+dx*Math.sin(phase)+dz*Math.cos(phase)];
}
export function orbitHasPerspective(start,target){
  return Math.hypot(start[0]-target[0],start[2]-target[2])>1e-6;
}
