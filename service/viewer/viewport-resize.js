/**
 * Update only the canvas backing size and perspective aspect ratio.
 * The camera's position, quaternion, up vector and orbit target are deliberately
 * untouched: iPad rotation must not reset the user's orbit/pan/zoom.
 * The caller remains responsible for fitting new models explicitly.
 */
export function resizeViewportProjection(renderer,camera,width,height){
  const w=Math.max(1,Math.round(width)),h=Math.max(1,Math.round(height));
  renderer.setSize(w,h,false);
  camera.aspect=w/h;
  camera.updateProjectionMatrix();
}
