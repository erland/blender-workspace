import test from 'node:test';
import assert from 'node:assert/strict';
import {themeStyles,themedCss} from '../dist/web/theme.js';
import {projectIndexPage,projectDetailPage,modelImportPage,jobsOverviewPage} from '../dist/web/project-pages.js';
import {viewerPage} from '../dist/viewer-page.js';
import {ownerSharePage,publicSharePage} from '../dist/web/public-share-page.js';

const id='11111111-1111-4111-8111-111111111111';
const project={id,name:'Testmodell',description:'',current_revision:1,updated_at:new Date('2026-11-23')};
const rev={revision:1,note:'Första',artifact_prefix:id+'/00000001',
 created_at:new Date('2026-11-23'),glbAvailable:true,resourceCount:0};

function checkTheme(html,label){
 assert.ok(html.includes('@media (prefers-color-scheme:dark)'),label+' must follow OS setting');
 assert.ok(html.includes('--page:#121923'),label+' must support dark surface');
 assert.ok(html.includes('color-scheme:light'),label+' must default to light');
 assert.ok(html.includes('color-scheme:dark'),label+' must opt into dark native controls');
 assert.ok(html.includes('var(--surface)'),label+' must use shared surfaces');
 assert.ok(!html.includes('localStorage'),label+' must not require saved user preferences');
}

test('DESIGN-001 every major portal/3D/share surface uses one automatic system palette',()=>{
 checkTheme(projectIndexPage([{project,revisions:[rev]}]),'project list');
 checkTheme(projectDetailPage(project,[rev],'csrf',undefined,[],[],'overview'),'overview');
 checkTheme(projectDetailPage(project,[rev],'csrf',undefined,[],[],'history'),'history');
 checkTheme(modelImportPage('csrf',[],[]),'model import');
 checkTheme(jobsOverviewPage([]),'job list');
 checkTheme(viewerPage(id,1),'3D viewer');
 checkTheme(publicSharePage('S'.repeat(43),'Model',1),'anonymous share');
 checkTheme(ownerSharePage(id,1,'csrf','active'),'share admin');
});

test('DESIGN-001 mapping is applied only to trusted CSS, not model metadata',()=>{
 const css='body{background:#f4f7fb;color:#19263b}'+
  'article{background:white;border:1px solid #d8e2ed}'+
  '.button{background:#215dd5;color:white}';
 const converted=themedCss(css);
 assert.match(converted,/background:var\(--page\)/);
 assert.match(converted,/color:var\(--text\)/);
 assert.match(converted,/background:var\(--surface\)/);
 assert.match(converted,/border:1px solid var\(--border\)/);
 assert.match(converted,/background:var\(--accent\);color:var\(--button-text\)/);
 const html=projectIndexPage([{project:{...project,name:'#215dd5 modell'},revisions:[rev]}]);
 assert.match(html,/#215dd5 modell/,'user-provided labels are untouched');
 assert.ok(!html.includes('<script src="https:'),'no third-party styling dependency');
});

test('DESIGN-001 accessible focus and native controls have system-dependent tokens',()=>{
 assert.ok(themeStyles.includes('--focus:#a0c2ff'));
 assert.ok(themeStyles.includes('--accent-text:#bad1ff'));
 const processed=themedCss('select{background:#fff;color:#172033;border:1px solid #8090a9}');
 assert.ok(processed.includes('color:var(--text)'));
 assert.ok(processed.includes('background-color:var(--surface);color:var(--text)'));
 assert.ok(processed.includes(':focus-visible{outline-color:var(--focus)}'));
});
