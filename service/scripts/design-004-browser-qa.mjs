/**
 * DESIGN-004 screenshot-backed browser acceptance (offline synthetic data).
 *
 * Execute after `npm run build`: node scripts/design-004-browser-qa.mjs.
 * Relies on Playwright Chromium installed by the dedicated GitHub workflow.
 * Exact production server-side templates and CSS; no OAuth, private data,
 * Modal charges, external site or mocked hand-written replacement HTML.
 */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {projectIndexPage,projectDetailPage,modelImportPage,jobsOverviewPage} from '../dist/web/project-pages.js';
import {viewerPage} from '../dist/viewer-page.js';
import {publicSharePage,ownerSharePage} from '../dist/web/public-share-page.js';

const output=process.env.DESIGN_QA_OUTPUT||'design-qa-output';
await mkdir(output,{recursive:true});
const id='11111111-1111-4111-8111-111111111111';
const date=new Date('2026-11-23T10:00:00Z');
const project={id,name:'En mycket detaljerad modell med långt projektnamn – robot och teknisk modell',
 description:'Ett projekt med flera revisioner, animationer och externa texturer. Beskrivningen används för att testa mobila radbrytningar.',
 current_revision:3,updated_at:date};
const revisions=[1,2,3].map(revision=>({revision,note:'Revision '+revision+' – modellförändring',
 artifact_prefix:id+'/'+String(revision).padStart(8,'0'),created_at:date,
 glbAvailable:true,resourceCount:revision===3?2:0}));
const projects=Array.from({length:8},(_,i)=>({
 project:{...project,id:'11111111-1111-4111-8111-'+String(i+1).padStart(12,'0'),
 name:'Projekt '+(i+1)+' – '+(i%2?'En mer detaljerad robotmodell':'T-rex med texturer')},
 revisions
}));
const uploads=[{id:'33333333-3333-4333-8333-333333333333',filename:'min-modell.blend',format:'blend',size_bytes:10240},
 {id:'44444444-4444-4444-8444-444444444444',filename:'base-color.png',format:'png',size_bytes:30720}];
const pages={
 projects:projectIndexPage(projects),
 overview:projectDetailPage(project,revisions,'test-csrf',undefined,[],[],'overview'),
 history:projectDetailPage(project,revisions,'test-csrf',undefined,[],[],'history'),
 images:projectDetailPage(project,revisions,'test-csrf','render_open',[],[],'images'),
 import:modelImportPage('test-csrf',uploads,[project]),
 texture:modelImportPage('test-csrf',uploads,[project],undefined,'texture'),
 jobs:jobsOverviewPage([]),
 viewer:viewerPage(id,3),
 public:publicSharePage('a'.repeat(43),project.name,3,[],true,true),
 share:ownerSharePage(id,3,'test-csrf','active',undefined,[],[],'download_saved',true)
};
const viewports=[
 {id:'iphone-portrait',width:390,height:844},
 {id:'iphone-landscape',width:844,height:390},
 {id:'ipad-portrait',width:820,height:1180},
 {id:'ipad-landscape',width:1180,height:820},
 {id:'desktop',width:1440,height:900}
];
const captureNames=new Set(['projects','overview','history','viewer','share','texture','public']);
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
let tests=0;
const failures=[];
function ensure(condition,description){tests++;if(!condition)failures.push(description);}
function luminance(rgb){
 const c=rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
 return c[0]*.2126+c[1]*.7152+c[2]*.0722;
}
function parseColor(color){
 const match=color.match(/^rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/i);
 return match?match.slice(1,4).map(Number):null;
}
function contrast(a,b){
 const x=luminance(a),y=luminance(b);
 return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
try{
 for(const scheme of ['light','dark']){
  for(const viewport of viewports){
   const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},
    deviceScaleFactor:1,colorScheme:scheme,reducedMotion:'reduce'});
   const page=await context.newPage();
   for(const [name,markup] of Object.entries(pages)){
    // Actual server-rendered HTML; disable external client bundles so a test
    // never requires authenticated API responses or talks to production.
    const staticMarkup=markup.replace(/<script\\b[^>]*>[\\s\\S]*?<\\/script>/gi,'');
    await page.setContent(staticMarkup,{waitUntil:'domcontentloaded'});
    await page.evaluate(()=>document.fonts.ready);
    const dimensions=await page.evaluate(()=>({
     screen:document.documentElement.clientWidth,
     overflow:document.documentElement.scrollWidth,
     bodyWidth:document.body.scrollWidth,
     theme:getComputedStyle(document.documentElement).colorScheme,
     pageBg:getComputedStyle(document.body).backgroundColor,
     pageText:getComputedStyle(document.body).color
    }));
    const label=scheme+'/'+viewport.id+'/'+name;
    ensure(dimensions.overflow<=dimensions.screen+2,
      label+' horizontal overflow '+dimensions.overflow+' > '+dimensions.screen);
    ensure(dimensions.bodyWidth<=dimensions.screen+2,
      label+' body horizontal overflow');
    ensure(dimensions.theme.includes(scheme),
      label+' wrong color-scheme '+dimensions.theme);
    const textColor=parseColor(dimensions.pageText),background=parseColor(dimensions.pageBg);
    if(textColor&&background)
     ensure(contrast(textColor,background)>=4.5,
      label+' body text/background contrast below 4.5');
    if(name==='viewer'){
     const positions=await page.evaluate(()=>{
      const box=id=>{const r=document.getElementById(id).getBoundingClientRect();
       return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};
      return {canvas:box('viewport'),toolbar:document.querySelector('.viewer-toolbar').getBoundingClientRect().toJSON(),
       compare:box('comparison-viewport')};
     });
     ensure(positions.canvas.width>140&&positions.canvas.height>=190,label+' viewport too small');
     ensure(positions.toolbar.top>=positions.canvas.bottom-2,label+' toolbar overlaps 3D canvas');
     // Test the alternate compare layout, without booting 3D rendering.
     await page.locator('#compare-pane').evaluate(element=>{element.hidden=false});
     const compare=await page.evaluate(()=>{
      const a=document.getElementById('viewport').getBoundingClientRect();
      const b=document.getElementById('comparison-viewport').getBoundingClientRect();
      return {a:a.toJSON(),b:b.toJSON(),overflow:document.documentElement.scrollWidth};
     });
     ensure(compare.overflow<=viewport.width+2,label+' compare mode overflows');
     ensure(viewport.width<=1024?
      compare.b.top>=compare.a.bottom-2:compare.b.left>=compare.a.right-2,
      label+' compare panes overlap');
     await page.locator('#compare-pane').evaluate(element=>{element.hidden=true});
    }
    if(name==='history'){
     // Secondary actions must not cover other rows when closed, and must open.
     const menu=page.locator('.revision-actions-menu').first();
     await menu.locator('summary').click();
     ensure(await menu.evaluate(el=>el.open),label+' revision action menu cannot open');
     ensure((await menu.locator('.revision-menu-items').boundingBox())!==null,label+' menu invisible');
     await menu.locator('summary').click();
    }
    if(name==='overview'){
     ensure(await page.locator('.model-actions .button').count()>0,
       label+' current-model primary action missing');
    }
    if(captureNames.has(name)&&(
      viewport.id==='iphone-portrait'||viewport.id==='ipad-portrait'||
      (name==='viewer'&&viewport.id==='iphone-landscape')||
      (name==='viewer'&&viewport.id==='ipad-landscape')||
      (name==='projects'&&viewport.id==='desktop'))){
     await page.screenshot({path:path.join(output,scheme+'-'+viewport.id+'-'+name+'.png'),fullPage:true,
      animations:'disabled'});
    }
   }
   await context.close();
  }
 }
}finally{await browser.close()}
console.log('DESIGN-004: '+tests+' browser assertions, '+failures.length+' failures');
if(failures.length){for(const f of failures)console.error('FAIL '+f);process.exitCode=1}
else console.log('PASS: responsive layout, theme, contrast, actions and comparison');
