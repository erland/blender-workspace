import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {viewerPage} from '../dist/viewer-page.js';

const id='11111111-1111-4111-8111-111111111111';
const html=viewerPage(id,7);
test('UX-003 viewer navigates back to the same project rather than the project list',()=>{
 assert.ok(html.includes('href="/projects/'+id+'" aria-label="Tillbaka till projektet"'));
 assert.ok(html.includes('href="/projects/'+id+'?view=images"'));
 assert.ok(html.includes('href="/projects/'+id+'?view=history"'));
 assert.ok(html.includes('href="/settings"'));
});
test('UX-003 puts the 3D canvas ahead of primary actions and keeps render trigger outside collapsed settings',()=>{
 const canvas=html.indexOf('id="viewport"');
 const toolbar=html.indexOf('class="viewer-toolbar"');
 const render=html.indexOf('id="render-current-view"');
 const settings=html.indexOf('id="viewer-settings"');
 const gallery=html.indexOf('id="render-history"');
 assert.ok(canvas>=0&&canvas<toolbar&&toolbar<render&&render<settings&&settings<gallery);
 assert.equal((html.match(/id="render-current-view"/g)||[]).length,1);
 assert.ok(html.includes('class="primary" disabled>Rendera vy (Modal)'));
 assert.ok(html.includes('<details class="viewer-settings"'));
 assert.match(html,/<summary><svg class="bw-icon"[^>]*>[\\s\\S]*?<\\/svg> Visningsinställningar<\\/summary>/);
 assert.ok(!html.includes('<details class="viewer-settings" id="viewer-settings" open'));
});
test('UX-003 secondary controls are accessible, retained and do not take up mobile canvas space',()=>{
 for(const name of ['view-angle','show-bounds','show-axes','show-wireframe',
   'revision-picker','copy-selection','reset','snapshot','comparison-viewport']){
   assert.ok(html.includes('id="'+name+'"'),name);
 }
 assert.ok(html.includes('id="selection-bar" hidden'));
 assert.match(html,/@media\(max-width:720px\)/);
 assert.match(html,/height:clamp\(280px,56dvh,560px\)/);
 assert.match(html,/min-height:44px/);
 assert.match(html,/aria-label="Exportera PNG"/);
 assert.match(html,/aria-label="Återställ vy"/);
 assert.doesNotMatch(html,/Bearer|MODAL_TOKEN|opaque-signed-session/);
});
test('UX-003 renderer keeps existing camera, PNG and confirmation functionality',async()=>{
 const src=await readFile(new URL('../viewer/client.js',import.meta.url),'utf8');
 assert.match(src,/selectionBar\.hidden=true/);
 assert.match(src,/selectionBar\.hidden=false/);
 assert.match(src,/getBoundingClientRect\(\)/);
 assert.match(src,/main\.camera\.position\.toArray\(\)/);
 assert.match(src,/main\.controls\.target\.toArray\(\)/);
 assert.match(src,/renderButton\.addEventListener\('click'/);
 assert.match(src,/confirm\('Starta Cycles-rendering/);
 assert.match(src,/toBlob\(/);
 assert.match(src,/revisionPicker\.addEventListener\('change'/);
});
