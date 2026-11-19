import * as THREE from 'three';

// Camera axes are Three.js/glTF world coordinates (Y up); no Blender compute.
export const VIEW_DIRECTIONS=Object.freeze({
  isometric:[1,0.8,1],
  front:[0,0,1],
  back:[0,0,-1],
  left:[-1,0,0],
  right:[1,0,0],
  top:[0,1,0]
});
export const DEFAULT_VIEW='isometric';

/** Fit the whole world-space model into either a portrait or landscape viewport. */
export function cameraPlacement(bounds,view=DEFAULT_VIEW,aspect=1,verticalFovDegrees=45){
  if(!bounds||bounds.isEmpty()||!(view in VIEW_DIRECTIONS))
    throw new RangeError('Unknown view or empty model');
  if(!Number.isFinite(aspect)||aspect<=0||!Number.isFinite(verticalFovDegrees)||
     verticalFovDegrees<=1||verticalFovDegrees>=170)
    throw new RangeError('Invalid camera dimensions');
  const center=bounds.getCenter(new THREE.Vector3());
  const radius=Math.max(bounds.getSize(new THREE.Vector3()).length()/2,0.01);
  const halfVertical=THREE.MathUtils.degToRad(verticalFovDegrees/2);
  const halfHorizontal=Math.atan(Math.tan(halfVertical)*aspect);
  const distance=radius/Math.sin(Math.min(halfVertical,halfHorizontal))*1.30;
  const direction=new THREE.Vector3(...VIEW_DIRECTIONS[view]).normalize();
  // Top-down view needs a non-collinear up vector for OrbitControls/lookAt.
  const up=view==='top'?new THREE.Vector3(0,0,-1):new THREE.Vector3(0,1,0);
  return {
    position:center.clone().addScaledVector(direction,distance),
    center,up,distance,radius,
    near:Math.max(0.001,distance/1000),
    far:distance*1000,
    minDistance:Math.max(0.001,radius*0.02),
    maxDistance:Math.max(10,radius*100)
  };
}
