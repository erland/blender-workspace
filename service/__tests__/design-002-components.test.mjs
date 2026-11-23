import test from 'node:test';
import assert from 'node:assert/strict';
import {componentStyles,themeStyles} from '../dist/web/theme.js';
import {uiIcon} from '../dist/web/icons.js';
import {projectIndexPage,projectDetailPage,modelImportPage,jobsOverviewPage} from '../dist/web/project-pages.js';
import {viewerPage} from '../dist/viewer-page.js';
import {publicSharePage,ownerSharePage} from '../dist/web/public-share-page.js';

const id='11111111-1111-4111-8111-111111111111';
const date=new Date('2026-11-23T12:00:00Z');
const project={id,name:'A <B> robot',description:'Test',current_revision:1,updated_at:date};
const revision={revision:1,note:'First',artifact_prefix:id+'/00000001',created_at:date,glbAvailable:true};

test('DESIGN-002 shared components are present in every web surface and after local styles',()=>{
 const pages=[
  ['projects',projectIndexPage([{project,revisions:[revision]}])],
  ['details',projectDetailPage(project,[revision],'csrf')],
  ['import',modelImportPage('csrf',[],[])],
  ['jobs',jobsOverviewPage([])],
  ['viewer',viewerPage(id,1)],
  ['public share',publicSharePage('Z'.repeat(43),'Robot',1)],
  ['owner share',ownerSharePage(id,1,'csrf','active')]
 ];
 for(const [name,html] of pages){
  assert.ok(html.includes('--radius-lg:16px'),name);
  assert.ok(html.includes('--elevation:0 8px 28px'),name);
  assert.ok(html.includes('prefers-reduced-motion:reduce'),name);
  assert.ok(html.indexOf('componentStyles')===-1,name+' should contain real styles not placeholders');
  assert.ok(html.indexOf('--radius-lg:16px')>html.indexOf('--page:#121923'),name+' keeps theme first');
  assert.ok(html.includes('color-scheme:dark'),name);
  assert.ok(html.includes('outline:3px solid var(--focus)'),name);
  assert.ok(!html.includes('fonts.googleapis.com'),name);
 }
 assert.ok(themeStyles.includes('--accent:#84abff'));
 assert.match(componentStyles,/--radius-lg:16px/);
});

test('DESIGN-002 icons are static semantic SVGs with no network or user input',()=>{
 for(const name of ['cube','grid','image','history','download','settings','share','more','arrow','camera','reset']){
  const svg=uiIcon(name);
  assert.match(svg,/^<svg class="bw-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">/);
  assert.match(svg,/<\/svg>$/);
  assert.ok(!svg.includes('<script'));
  assert.ok(!svg.includes('href='));
 }
 const portal=projectIndexPage([{project,revisions:[revision]}]);
 assert.ok(portal.includes('<svg class="bw-icon"'));
 assert.ok(portal.includes('A &lt;B&gt; robot'),'model names remain HTML-escaped');
 const viewer=viewerPage(id,1);
 assert.ok(viewer.includes('id="snapshot"'));
 assert.ok(viewer.includes('aria-label="Exportera PNG"'));
 assert.ok(viewer.includes('id="reset"'));
 assert.ok(viewer.includes('aria-label="Återställ vy"'));
});

test('DESIGN-002 accessible form controls and primary actions retain appropriate tokens',()=>{
 assert.ok(componentStyles.includes('min-height:44px'));
 assert.ok(componentStyles.includes('background:var(--accent);color:var(--button-text)'));
 assert.ok(componentStyles.includes('background:var(--accent-soft);color:var(--accent-text)'));
 assert.ok(componentStyles.includes('background:var(--surface);color:var(--text)'));
 assert.ok(componentStyles.includes('accent-color:var(--accent)'));
 assert.ok(componentStyles.includes('outline:3px solid var(--focus)'));
 assert.ok(componentStyles.includes(':focus-visible'));
 assert.ok(componentStyles.includes('prefers-reduced-motion:reduce'));
});
