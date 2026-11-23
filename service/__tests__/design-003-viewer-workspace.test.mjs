import test from 'node:test';
import assert from 'node:assert/strict';
import {viewerPage} from '../dist/viewer-page.js';
import {viewerWorkspaceStyles} from '../dist/web/viewer-workspace-styles.js';

const project='11111111-1111-4111-8111-111111111111';
const html=viewerPage(project,8);

test('DESIGN-003 professional stage preserves WebGL canvas and action contracts',()=>{
 assert.match(html,/<div class="viewer-workspace"><main aria-label="3D-arbetsyta">/);
 assert.ok(html.includes('Revision 8'));
 assert.ok(html.includes('id="viewport"'));
 assert.ok(html.includes('id="comparison-viewport"'));
 assert.ok(html.includes('id="compare-pane" hidden'));
 for(const id of ['render-current-view','snapshot','reset','animation-bar','viewer-settings',
   'revision-picker','render-history','status','comparison','selection-bar']){
  assert.ok(html.includes('id="'+id+'"'),id+' must retain original DOM ID');
 }
 assert.match(html,/<div class="viewer-toolbar" role="group" aria-label="Åtgärder för aktuell 3D-vy">/);
 assert.match(html,/id="render-current-view" class="primary" disabled/);
 assert.ok(html.includes('aria-label="Exportera PNG"'));
 assert.ok(html.includes('aria-label="Återställ vy"'));
 assert.ok(html.includes('/viewer/assets/viewer.js'));
 assert.ok(html.includes('aria-hidden="true"'));
 assert.ok(html.includes('</div></div>\n<div id="animation-bar"'),
   'work surface is closed before animation controls');
});

test('DESIGN-003 CSS adapts stage, comparisons and gallery to iPhone/iPad without JS',()=>{
 const css=viewerWorkspaceStyles;
 assert.ok(css.includes('.viewer-workspace .viewport{'));
 assert.ok(css.includes('background:var(--surface-muted)'));
 assert.ok(css.includes('.viewer-workspace .viewer-toolbar'));
 assert.ok(css.includes('color:var(--button-text)'));
 assert.ok(css.includes('pointer-events:none'));
 assert.ok(css.includes('@media(max-width:720px)'));
 assert.ok(css.includes('(orientation:landscape)'));
 assert.ok(css.includes('@media(max-width:1024px)'));
 assert.ok(css.includes('#compare-pane:not([hidden])'));
 assert.ok(css.includes('height:clamp(220px,30dvh,390px)'));
 assert.ok(css.includes('.render-gallery{display:grid'));
 assert.ok(!css.includes('position:fixed'),'controls must not cover canvas on mobile');
 assert.ok(html.includes('prefers-color-scheme:dark'));
 assert.ok(html.indexOf('viewer-workspace{')>html.indexOf('--radius-lg:16px'),
   'viewer styles should override shared components but not duplicate them');
});

test('DESIGN-003 all viewer icons are accessible or decorative and no new network dependencies',()=>{
 assert.ok(html.includes('<svg class="bw-icon"'));
 assert.ok(html.includes('Visningsinställningar'));
 assert.ok(html.includes('focusable="false"'));
 assert.ok(!html.includes('fonts.googleapis.com'));
 assert.ok(!html.includes('cdnjs.cloudflare.com'));
 assert.equal((html.match(/id="viewport"/g)||[]).length,1);
});
