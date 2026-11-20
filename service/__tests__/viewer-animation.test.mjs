import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {ClipPlayer} from '../viewer/clip-player.js';
import {viewerPage} from '../dist/viewer-page.js';

function animatedModel(){
  const root=new THREE.Group();
  const cube=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());
  cube.name='MovingCube';
  root.add(cube);
  const walk=new THREE.AnimationClip('Move',2,[
    new THREE.VectorKeyframeTrack('MovingCube.position',[0,2],[0,0,0,2,0,0])
  ]);
  const rise=new THREE.AnimationClip('Rise',1,[
    new THREE.VectorKeyframeTrack('MovingCube.position',[0,1],[0,0,0,0,3,0])
  ]);
  return {root,cube,walk,rise};
}
test('ANIM-001 Three.js mixer seeks and switches GLB animation clips',()=>{
  const {root,cube,walk,rise}=animatedModel();
  const player=new ClipPlayer(root,[walk,rise]);
  assert.deepEqual(player.names,[{index:0,name:'Move'},{index:1,name:'Rise'}]);
  assert.equal(player.select(0),true);
  assert.equal(player.duration,2);
  player.seek(1);
  assert.ok(Math.abs(cube.position.x-1)<0.0001);
  player.seek(2);
  assert.ok(Math.abs(cube.position.x-2)<0.0001);
  assert.equal(player.select(1),true);
  player.seek(0.5);
  assert.ok(Math.abs(cube.position.y-1.5)<0.0001);
  player.seek(100);
  assert.equal(player.currentTime,1);
  player.dispose();
});
test('ANIM-001 static GLBs and invalid clips have no playable timeline',()=>{
  const root=new THREE.Group();
  const player=new ClipPlayer(root,[]);
  assert.deepEqual(player.names,[]);
  assert.equal(player.select(0),false);
  assert.equal(player.duration,0);
  player.seek(5);
  player.dispose();
});
test('ANIM-001 responsive playback controls are hidden until animation exists',async()=>{
  const html=viewerPage('11111111-1111-4111-8111-111111111111',1);
  for(const id of ['animation-bar','animation-clip','animation-play','animation-seek',
    'animation-clock','animation-loop'])assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(html,/id="animation-bar"[^>]*hidden/);
  assert.match(html,/aria-label="Animationsposition"/);
  assert.match(html,/min-height:44px/);
  const client=await readFile(new URL('../viewer/client.js',import.meta.url),'utf8');
  assert.match(client,/new ClipPlayer\(model,clips\)/);
  assert.match(client,/viewport\.setAnimations\(model,gltf\.animations\)/);
  assert.match(client,/animationBar\.hidden=clips\.length===0/);
  assert.match(client,/selectComparisonClip\(\)/);
  assert.match(client,/document\.hidden/);
  assert.doesNotMatch(client,/MODAL_TOKEN_SECRET|workspace_queue_python_script/);
});
