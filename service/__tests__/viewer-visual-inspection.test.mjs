import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {cameraPlacement,VIEW_DIRECTIONS,DEFAULT_VIEW}
  from '../viewer/view-controls.js';
import {viewerPage} from '../dist/viewer-page.js';

const bounds=new THREE.Box3(new THREE.Vector3(-2,-1,-3),
  new THREE.Vector3(2,3,3));

test('DEV-031 all six browser-only camera presets point at the model center',()=>{
  assert.equal(DEFAULT_VIEW,'isometric');
  assert.deepEqual(Object.keys(VIEW_DIRECTIONS),
    ['isometric','front','back','left','right','top']);
  const center=bounds.getCenter(new THREE.Vector3());
  for(const view of Object.keys(VIEW_DIRECTIONS)){
    const framing=cameraPlacement(bounds,view,16/9,45);
    assert.ok(framing.distance>0&&framing.far>framing.near);
    assert.ok(framing.center.equals(center));
    const displacement=framing.position.clone().sub(center).normalize();
    const expected=new THREE.Vector3(...VIEW_DIRECTIONS[view]).normalize();
    assert.ok(displacement.distanceTo(expected)<1e-9,view);
    assert.ok(Math.abs(displacement.dot(framing.up))<0.9999,
      'Camera up must not be parallel to view direction');
  }
});

test('DEV-031 portrait camera fits farther away than landscape',()=>{
  const portrait=cameraPlacement(bounds,'front',0.5,45);
  const landscape=cameraPlacement(bounds,'front',2,45);
  assert.ok(portrait.distance>landscape.distance);
  assert.ok(portrait.minDistance<portrait.maxDistance);
  assert.ok(portrait.near<portrait.distance);
  assert.ok(portrait.far>portrait.distance);
  assert.throws(()=>cameraPlacement(new THREE.Box3(),'front'),RangeError);
  assert.throws(()=>cameraPlacement(bounds,'unsupported'),RangeError);
  assert.throws(()=>cameraPlacement(bounds,'front',0),RangeError);
});

test('DEV-031 authenticated viewer page exposes keyboard-accessible controls',()=>{
  const html=viewerPage('11111111-1111-4111-8111-111111111111',2);
  for(const control of ['view-angle','show-bounds','show-axes',
      'show-wireframe','snapshot','reset','comparison-viewport']){
    assert.match(html,new RegExp('id="'+control+'"'));
  }
  for(const preset of Object.keys(VIEW_DIRECTIONS)){
    assert.match(html,new RegExp('value="'+preset+'"'));
  }
  assert.match(html,/Exportera PNG/);
  assert.doesNotMatch(html,/MODAL_TOKEN|bearer|secret|cdn\./i);
});

test('DEV-031 browser image export does not invoke Blender/Modal',async()=>{
  const src=await readFile(new URL('../viewer/client.js',import.meta.url),'utf8');
  assert.match(src,/toBlob\(/);
  assert.match(src,/image\/png/);
  assert.match(src,/cameraPlacement/);
  assert.match(src,/wireframeMaterials/);
  // Browser PNG export remains local; the new, explicitly confirmed
  // render button is a separate and intentionally billed feature.
  const snapshot=src.slice(src.indexOf("document.getElementById('snapshot').addEventListener"),
    src.indexOf("revisionPicker.addEventListener"));
  assert.equal(snapshot.includes('fetch('),false);
  assert.equal(snapshot.includes('renderApi'),false);
  assert.equal(snapshot.includes('Modal'),false);
  assert.equal(src.includes('/mcp'),false);
  assert.equal(src.includes('MODAL_TOKEN'),false);
  assert.equal(src.includes('workspace_queue_'),false);
  assert.ok(src.includes("renderButton.addEventListener('click'"));
  assert.ok(src.includes('confirm('));
});
