import test from 'node:test';
import assert from 'node:assert/strict';
import {projectDetailPage} from '../dist/web/project-pages.js';
import {ownerSharePage} from '../dist/web/public-share-page.js';

const id='11111111-1111-4111-8111-111111111111';
const now=new Date('2026-11-23T12:00:00Z');
const project={id,name:'Robot',description:'',current_revision:2,updated_at:now};
const revs=[{revision:1,artifact_prefix:id+'/00000001',created_at:now,glbAvailable:true},
 {revision:2,artifact_prefix:id+'/00000002',created_at:now,glbAvailable:true,resourceCount:2}];

test('UX-003 overview opens the render form for the latest revision without requiring more taps',()=>{
 const overview=projectDetailPage(project,revs,'csrf',undefined,[],[],'overview');
 assert.ok(overview.includes('?view=images&amp;message=render_open')||
   overview.includes('?view=images&message=render_open'));
 const images=projectDetailPage(project,revs,'csrf','render_open',[],[],'images');
 assert.match(images,/<details class="panel" id="render-settings"[^>]* open>/);
 assert.ok(images.includes('name="revision"'));
 assert.ok(images.includes('value="2" selected'));
 assert.ok(images.includes('name="confirm" value="yes" required'));
 assert.ok(images.includes('godkänner att renderingen startar ett kostnadsbelagt Modal-jobb'));
 assert.ok(images.includes('Större bild, fler samples och Cycles kan öka körtiden'));
 assert.ok(images.includes('Eevee – snabb förhandsbild'));
 assert.ok(images.includes('Cycles – mer realistisk bild'));
});
test('UX-003 share states reflect actual recipient rights without assuming upload rights',()=>{
 const active=ownerSharePage(id,2,'csrf','active',undefined,[],[],'download_saved',false);
 assert.ok(active.includes('Aktiv publik delning'));
 assert.ok(active.includes('Inte ladda ned modellen'));
 assert.ok(active.includes('1. Tillåt nedladdning'));
 assert.ok(active.includes('2. Välj vilka bilder som syns'));
 assert.ok(active.includes('Ja – BLEND eller ZIP med texturer'));
 assert.ok(active.includes('value="no" selected'));
 assert.ok(active.includes('Återkalla delningslänken'));
 const allowed=ownerSharePage(id,2,'csrf','active',undefined,[],[],'download_saved',true);
 assert.ok(allowed.includes('Ladda ned modellen'));
 assert.ok(allowed.includes('value="yes" selected'));
 const revoked=ownerSharePage(id,2,'csrf','revoked');
 assert.ok(revoked.includes('Delningen är återkallad'));
 assert.ok(!revoked.includes('id="download-permission"'));
 assert.ok(!revoked.includes('Återkalla delningslänken'));
});
