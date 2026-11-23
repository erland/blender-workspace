import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectDetailPage} from '../dist/web/project-pages.js';

const id=randomUUID(),renderA=randomUUID(),renderB=randomUUID(),renderC=randomUUID();
const project={id,name:'Projekt <katt>',description:'En detaljerad kattmodell.',
 current_revision:3,updated_at:new Date('2026-11-20T10:00:00Z')};
const revisions=[{revision:2,note:'Föregående modell',artifact_prefix:id+'/00000002',
 glbAvailable:true,created_at:new Date('2026-11-19T10:00:00Z')},
 {revision:3,note:'Päls',artifact_prefix:id+'/00000003',
 glbAvailable:true,created_at:new Date('2026-11-20T10:00:00Z')}];
const renders=[renderA,renderB,renderC].map((rid,i)=>({
 id:rid,source_revision:i===2?2:3,engine:'CYCLES',width:455,height:256,
 samples:16,status:'completed',created_at:new Date('2026-11-20T10:00:00Z'),
 requested_from:i%2?'viewer':'project'
}));
const body=(view)=>projectDetailPage(project,revisions,'csrf-token',undefined,renders,[],view);
test('UX-002 overview is short, shows preview images and routes to three main tasks',()=>{
 const html=body('overview');
 assert.match(html,/Senaste renderingar/);
 assert.match(html,/Visa alla bilder/);
 assert.match(html,/aria-label="Projektets funktioner"/);
 assert.match(html,new RegExp('/viewer/'+id+'/revisions/3'));
 assert.match(html,/view=images/);
 assert.match(html,/view=history/);
 assert.match(html,/view=settings/);
 assert.equal((html.match(/class="overview-image"/g)||[]).length,3);
 assert.match(html,/Aktuell modell/);
 for(const r of [renderA,renderB,renderC])assert.ok(html.includes('/renders/'+id+'/'+r+'.png'));
 assert.doesNotMatch(html,/id="project-name"|name="engine"|<h2>Revisionshistorik<\\/h2>|Modelleringsjobb/);
 assert.doesNotMatch(html,/<script>katt<\/script>|Projekt <katt>/);
});
test('UX-002 image view includes shared render jobs and collapsed render form',()=>{
 const html=body('images');
 assert.match(html,/aria-current="page"[^>]*>[^<]*<span class="tab-icon"[^>]*>▧/);
 assert.match(html,/Renderingsjobb och bilder/);
 assert.match(html,/Rendera bild från Blender/);
 assert.match(html,/<details class="panel"/);
 assert.match(html,/name="engine"/);
 assert.doesNotMatch(html,/id="project-name"|Revisionshistorik/);
 assert.equal((html.match(/class="render-thumb" href=/g)||[]).length,3);
});
test('UX-002 history view shows revisions and model jobs, not rendering controls or settings',()=>{
 const html=body('history');
 assert.match(html,/Revisionshistorik/);
 assert.match(html,/Föregående modell/);
 assert.match(html,/Modelleringsjobb/);
 assert.match(html,new RegExp('/viewer/'+id+'/revisions/2'));
 assert.doesNotMatch(html,/name="engine"|id="project-name"|Renderingsjobb och bilder/);
});
test('UX-002 settings view scopes edit forms and export/delete actions',()=>{
 const html=body('settings');
 assert.match(html,/id="project-name"/);
 assert.match(html,/id="project-description"/);
 assert.match(html,/Byt namn/);
 assert.match(html,/Spara beskrivning/);
 assert.match(html,/Exportera projekt/);
 assert.match(html,/Ta bort projektet/);
 assert.doesNotMatch(html,/name="engine"|Revisionshistorik|Renderingsjobb och bilder/);
});
test('UX-002 no 3D artifact displays accessible disabled state, images and history still available',()=>{
 const html=projectDetailPage({...project,current_revision:0},[],undefined,undefined,[],[],'overview');
 assert.match(html,/3D saknas/);
 assert.match(html,/aria-disabled="true"/);
 assert.match(html,/view=images/);
 assert.match(html,/view=history/);
 assert.doesNotMatch(html,/\/viewer\//);
 assert.doesNotMatch(html,/Projektinställningar/);
});
