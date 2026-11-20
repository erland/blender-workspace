import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
import {viewerPage} from '../dist/viewer-page.js';
import {resizeViewportProjection} from '../viewer/viewport-resize.js';

test('UX-005 iPad rotation preserves an arbitrary user orbit, zoom, pan, up and projection settings',()=>{
 const camera=new THREE.PerspectiveCamera(45,1,0.2,5000);
 camera.position.set(9.1,4.2,-12);
 camera.up.set(0,0,-1);
 camera.rotation.set(0.3,-0.7,0.1);
 camera.zoom=1.65;
 camera.updateProjectionMatrix();
 const target=new THREE.Vector3(2,-3,1.2);
 const position=camera.position.clone(),quaternion=camera.quaternion.clone();
 const up=camera.up.clone(),zoom=camera.zoom,near=camera.near,far=camera.far;
 const setSizes=[];
 const renderer={setSize:(width,height,updateStyle)=>setSizes.push({width,height,updateStyle})};
 for(const [width,height] of [[820,1180],[1180,820],[820,1180],[0,0]]){
   resizeViewportProjection(renderer,camera,width,height);
   assert.ok(camera.position.equals(position),'orbit distance/position preserved');
   assert.ok(camera.quaternion.equals(quaternion),'camera direction preserved');
   assert.ok(camera.up.equals(up),'up vector preserved');
   assert.ok(target.equals(new THREE.Vector3(2,-3,1.2)),'pan target preserved');
   assert.equal(camera.zoom,zoom);
   assert.equal(camera.near,near);
   assert.equal(camera.far,far);
   assert.ok(Number.isFinite(camera.projectionMatrix.elements[0]));
 }
 assert.deepEqual(setSizes.map(x=>[x.width,x.height]),[[820,1180],[1180,820],[820,1180],[1,1]]);
 assert.ok(setSizes.every(x=>x.updateStyle===false));
 assert.equal(camera.aspect,1);
});
test('UX-005 aspect ratio updates without moving the viewpoint',()=>{
 const camera=new THREE.PerspectiveCamera(45,1,0.1,1000);
 camera.position.set(2,3,4);
 const renderer={setSize(){}};
 resizeViewportProjection(renderer,camera,820,1180);
 assert.ok(Math.abs(camera.aspect-820/1180)<1e-12);
 const portraitProjection=camera.projectionMatrix.clone();
 resizeViewportProjection(renderer,camera,1180,820);
 assert.ok(Math.abs(camera.aspect-1180/820)<1e-12);
 assert.ok(!portraitProjection.equals(camera.projectionMatrix));
 assert.deepEqual(camera.position.toArray(),[2,3,4]);
});
test('UX-005 portrait comparison stacks bounded-height panes, landscape remains split',()=>{
 const html=viewerPage('11111111-1111-4111-8111-111111111111',3);
 assert.match(html,/@media\(max-width:1024px\)/);
 assert.match(html,/\.viewports:has\(#compare-pane:not\(\[hidden\]\)\)\{grid-template-columns:minmax\(0,1fr\)\}/);
 assert.match(html,/height:clamp\(240px,30dvh,390px\)/);
 assert.match(html,/\.viewports:has\(#compare-pane:not\(\[hidden\]\)\)\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
 assert.match(html,/height:clamp\(220px,30dvh,390px\)/);
});
test('UX-005 explicit reset and camera preset still fit model, not viewport resize',async()=>{
 const src=await readFile(new URL('../viewer/client.js',import.meta.url),'utf8');
 assert.match(src,/resizeViewportProjection\(renderer,camera,rect.width,rect.height\)/);
 const resizeBlock=src.slice(src.indexOf('  const resize=()=>{'),src.indexOf('  const observer=new ResizeObserver'));
 assert.doesNotMatch(resizeBlock,/orient\(|\.fit\(|controls\.target\.|camera\.position\./);
 assert.match(src,/function fit\(\)\{orient\(state.viewAngle\);\}/);
 assert.match(src,/viewPicker\.addEventListener\('change'/);
 assert.match(src,/main\.fit\(\);secondary\.fit\(\)/);
});
