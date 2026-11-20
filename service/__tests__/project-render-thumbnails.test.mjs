import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectDetailPage} from '../dist/web/project-pages.js';

const id=randomUUID(),projectJob=randomUUID(),viewerJob=randomUUID(),failedJob=randomUUID(),queuedJob=randomUUID();
const project={id,name:'Päls & modeller',description:'',current_revision:3,updated_at:new Date('2026-11-20T12:00:00Z')};
const revisions=[1,2,3].map(revision=>({revision,note:'',artifact_prefix:id+'/'+revision,created_at:new Date('2026-11-20T12:00:00Z')}));
const base={engine:'CYCLES',width:455,height:256,samples:16,created_at:new Date('2026-11-20T12:00:00Z')};
test('project page shows same click-to-open lazy images from project and GLB viewer render jobs',()=>{
 const renders=[
  {...base,id:projectJob,source_revision:3,status:'completed',requested_from:'project'},
  {...base,id:viewerJob,source_revision:3,status:'completed',requested_from:'viewer'},
  {...base,id:failedJob,source_revision:2,status:'failed',error_code:'render_failed'},
  {...base,id:queuedJob,source_revision:1,status:'pending'}
 ];
 const html=projectDetailPage(project,revisions,'csrf',undefined,renders,[],'images');
 for(const jobId of [projectJob,viewerJob]){
  const url='/renders/'+id+'/'+jobId+'.png';
  assert.ok(html.includes('src="'+url+'"'));
  assert.ok(html.includes('href="'+url+'"'));
 }
 assert.equal((html.match(/loading="lazy"/g)||[]).length,2);
 assert.equal((html.match(/class="render-thumb" href=/g)||[]).length,2);
 assert.ok(html.indexOf('Renderingar för revision 3')<html.indexOf('Renderingar för revision 2'));
 assert.ok(html.indexOf('Renderingar för revision 2')<html.indexOf('Renderingar för revision 1'));
 assert.ok(!html.includes('/renders/'+id+'/'+failedJob+'.png'));
 assert.ok(!html.includes('/renders/'+id+'/'+queuedJob+'.png'));
 assert.match(html,/Misslyckades/);
 assert.match(html,/I kö/);
 assert.doesNotMatch(html,/Visa PNG-bild/);
});
test('render status errors are escaped and failed jobs never receive image elements',()=>{
 const html=projectDetailPage(project,revisions,'csrf',undefined,[
  {...base,id:failedJob,source_revision:2,status:'failed',error_code:'<script>alert(1)</script>'}
 ],[],'images');
 assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);
 assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
 assert.doesNotMatch(html,/<img/);
});
test('empty render history retains a useful empty state',()=>{
 const html=projectDetailPage(project,revisions,'csrf',undefined,[],[],'images');
 assert.match(html,/Inga renderingar ännu/);
 assert.doesNotMatch(html,/class="render-tile"/);
});
