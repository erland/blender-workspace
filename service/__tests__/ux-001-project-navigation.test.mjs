import test from 'node:test';
import assert from 'node:assert/strict';
import {projectDetailPage} from '../dist/web/project-pages.js';

const id='11111111-1111-4111-8111-111111111111';
const when=new Date('2026-11-23T10:00:00Z');
const project={id,name:'Min robot',description:'En texturerad modell',current_revision:3,updated_at:when};
const revision=(n,resources=0,glb=true)=>({
 revision:n,artifact_prefix:id+'/'+String(n).padStart(8,'0'),
 note:'Revision '+n+' uppdaterad',created_at:when,glbAvailable:glb,resourceCount:resources
});
const render={id:'22222222-2222-4222-8222-222222222222',
 source_revision:2,engine:'CYCLES',width:512,height:512,samples:16,
 status:'completed',created_at:when};

test('UX-001 model overview prioritizes current model and valid direct actions',()=>{
 const html=projectDetailPage(project,[revision(1),revision(2),revision(3,2)],
  'safe-csrf',undefined,[render],[],'overview');
 assert.ok(html.includes('<h2>Aktuell modell</h2>'));
 assert.ok(html.includes('Revision 3 · Sparad'));
 assert.ok(html.includes('/viewer/'+id+'/revisions/3'));
 assert.ok(html.includes('/projects/'+id+'?view=images'));
 assert.ok(html.includes('/projects/'+id+'/revisions/3/download'));
 assert.ok(html.includes('Ladda ned modell (ZIP med texturer)'));
 assert.ok(html.includes('/projects/'+id+'/revisions/3/share'));
 assert.ok(html.includes('Senaste renderingar'));
 assert.ok(html.includes('aria-label="Aktuell modell"'));
 assert.ok(!html.includes('Externa resurser ej verifierade'));
});
test('UX-001 revision menu hides secondary controls but preserves owner actions and accessible opener',()=>{
 const html=projectDetailPage(project,[revision(1),revision(2,0,false),revision(3,1)],
  'safe-csrf',undefined,[],[],'history');
 assert.ok(html.includes('class="revision-open"'));
 assert.ok(html.includes('aria-label="Fler val för Revision 3"'));
 assert.ok(html.includes('class="revision-actions-menu"'));
 assert.ok(html.includes('class="revision-menu-items"'));
 assert.ok(html.includes('history-panel'));
 assert.ok(html.includes('Ladda ned modell (ZIP med texturer)'));
 assert.ok(html.includes('Ladda ned modell (BLEND)'));
 assert.ok(html.includes('/projects/'+id+'/revisions/3/share'));
 assert.ok(html.includes('/projects/'+id+'/revisions/2/download'));
 assert.ok(!html.includes('/projects/'+id+'/revisions/2/share'));
 assert.ok(html.includes('3D saknas'));
 assert.ok(html.includes('@media(max-width:680px)'));
});
test('UX-001 missing preview does not create broken model buttons',()=>{
 const empty={...project,current_revision:0};
 const html=projectDetailPage(empty,[],undefined,undefined,[],[],'overview');
 assert.ok(html.includes('Ingen sparad revision'));
 assert.ok(html.includes('Ingen 3D-förhandsvisning ännu'));
 assert.ok(!html.includes('Ladda ned modell'));
 assert.ok(!html.includes('Dela revision'));
 assert.ok(html.includes('Revisionshistorik'));
});
