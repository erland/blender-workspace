import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectIndexPage,projectImportPage} from '../dist/web/project-pages.js';

const id=randomUUID(),job1=randomUUID(),job2=randomUUID();
const project={id,name:'Katt <modell>',description:'Lång beskrivning '.repeat(45),
 current_revision:3,updated_at:new Date('2026-11-20T15:00:00Z')};
const revisions=[{revision:3,artifact_prefix:id+'/00000003',glbAvailable:true}];
const renders=[job1,job2].map((id,i)=>({id,source_revision:3,
 requested_from:i?'viewer':'project',status:'completed',engine:'CYCLES',
 width:455,height:256,samples:16,created_at:new Date()}));

test('UX-001 uses a single semantic, focusable link for the entire project card',()=>{
 const html=projectIndexPage([{project,revisions,renders}],undefined,'session-csrf');
 const card=html.slice(html.indexOf('<article class="card">'),html.indexOf('</article>')+10);
 assert.match(card,new RegExp('<article class="card"><a class="project-card-link" href="/projects/'+id+'"'));
 assert.equal((card.match(/<a /g)||[]).length,1,'avoid competing links inside a project card');
 assert.match(card,/aria-label="Öppna projekt Katt &lt;modell&gt;"/);
 assert.match(card,/class="card-description muted"/);
 assert.match(html,/card-description\{display:-webkit-box/);
 assert.match(html,/-webkit-line-clamp:2/);
 assert.match(html,/project-card-link:focus-visible/);
 assert.equal((card.match(/loading="lazy"/g)||[]).length,2);
 assert.ok(card.includes('/renders/'+id+'/'+job1+'.png'));
 assert.ok(card.includes('/renders/'+id+'/'+job2+'.png'));
 assert.doesNotMatch(card,/target="_blank"|Visa projekt|Öppna GLB-förhandsvisning/);
 assert.doesNotMatch(card,/<script|Katt <modell>/);
});
test('UX-001 shows a compact list first; import is a dedicated secondary task',()=>{
 const html=projectIndexPage([{project,revisions,renders}],undefined,'session-csrf');
 assert.match(html,/href="\/projects\/import"/);
 assert.doesNotMatch(html,/id="import-project-form"/);
 assert.ok(html.indexOf('<article class="card">')>html.indexOf('<h1>Mina projekt</h1>'));
 const importHtml=projectImportPage('secret&token');
 assert.match(importHtml,/id="import-project-form"/);
 assert.match(importHtml,/archive\/assets\/import.js/);
 assert.match(importHtml,/name="csrf" value="secret&amp;token"/);
 assert.match(importHtml,/href="\/"/);
 assert.doesNotMatch(html,/secret&token/);
});
test('UX-001 no-image project still opens via whole card with accessible summary',()=>{
 const empty={...project,name:'Tomt projekt',description:'',current_revision:0};
 const html=projectIndexPage([{project:empty,revisions:[],renders:[]}],undefined,'csrf');
 assert.match(html,/class="illustration" aria-hidden="true"/);
 assert.match(html,/Ingen sparad modell/);
 assert.equal((html.match(/class="project-card-link"/g)||[]).length,1);
 assert.equal((html.match(/class="project-thumbnails"/g)||[]).length,0);
});
