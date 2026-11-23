import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {jobsOverviewPage,projectDetailPage} from '../dist/web/project-pages.js';

const id=randomUUID(),model=randomUUID(),render=randomUUID(),failed=randomUUID();
const date=new Date('2026-11-20T11:00:00Z');
const base={project_id:id,project_name:'Katt & <modell>',revision:2,
 created_at:date,detail:'Körning <test>',error:null};
const jobs=[
 {...base,id:model,type:'model',status:'running'},
 {...base,id:render,type:'render',status:'completed'},
 {...base,id:failed,type:'model',status:'failed',error:'Ingen <resurs>'}
];
test('UX-004 full job rows link to relevant project section with no duplicate action links',()=>{
 const html=jobsOverviewPage(jobs);
 const lines=html.match(/<li class="job-item">[\s\S]*?<\/li>/g)??[];
 assert.equal(lines.length,3);
 for(const row of lines)assert.equal((row.match(/<a /g)??[]).length,1);
 assert.ok(html.includes('href="/projects/'+id+'?view=history"'));
 assert.ok(html.includes('href="/projects/'+id+'?view=images"'));
 assert.match(html,/class="job-link"/);
 assert.match(html,/job-link:focus-visible/);
 assert.match(html,/min-height:76px/);
 assert.doesNotMatch(html,/Visa PNG|Visa revision|Visa projekt/);
 assert.match(html,/Katt &amp; &lt;modell&gt;/);
 assert.match(html,/Ingen &lt;resurs&gt;/);
 assert.doesNotMatch(html,/Ingen <resurs>|Körning <test>/);
});
test('UX-004 groups active and error work above collapsible completed history',()=>{
 const html=jobsOverviewPage(jobs);
 const active=html.indexOf('Pågående jobb (1)');
 const attention=html.indexOf('Kräver uppmärksamhet (1)');
 const archive=html.indexOf('Avslutade jobb (1)');
 assert.ok(active>=0&&active<attention&&attention<archive);
 assert.match(html,/<details id="live-job-archive" class="panel job-archive"/);
 assert.doesNotMatch(html,/<details id="live-job-archive" class="panel job-archive"[^>]* open/);
 assert.doesNotMatch(html,/<meta http-equiv="refresh"/);
 assert.ok(html.includes('/portal/assets/live-status.js'));
});
test('UX-004 finished-only jobs are visible by default and do not auto refresh',()=>{
 const html=jobsOverviewPage([jobs[1]]);
 assert.match(html,/<details id="live-job-archive" class="panel job-archive"[^>]* open/);
 assert.doesNotMatch(html,/Kräver uppmärksamhet/);
 assert.doesNotMatch(html,/<meta http-equiv="refresh" content="10">/);
});
test('UX-004 project history rows stay informational, not same-page navigational links',()=>{
 const project={id,name:'Katt',description:'',current_revision:2,updated_at:date};
 const revisions=[{revision:2,note:'Original',artifact_prefix:id+'/00000002',created_at:date,glbAvailable:true}];
 const html=projectDetailPage(project,revisions,'csrf',undefined,[],[
  {id:model,project_id:id,requested_revision:2,status:'running',note:'Modellering',
    error_message:null,created_at:date}
 ],'history');
 assert.match(html,/class="job-link job-static"/);
 assert.equal((html.match(/class="job-item"/g)??[]).length,1);
 const item=html.match(/<li class="job-item">[\s\S]*?<\/li>/)?.[0]??'';
 assert.doesNotMatch(item,/<a /);
 assert.match(html,/Alla jobb/);
});

test('DEV-050: only active modeling jobs expose a safe standalone cancel form',()=>{
  const html=jobsOverviewPage(jobs,'<csrf&>');
  const cancel=(html.match(/action="\/jobs\/[0-9a-f-]+\/cancel"/g)??[]);
  assert.equal(cancel.length,1);
  assert.match(html,/method="post"/);
  assert.match(html,/value="&lt;csrf&amp;&gt;"/);
  const row=html.match(/<li class="job-item">[\s\S]*?<\/li>/)?.[0]??'';
  assert.ok(row.indexOf('</a>')<row.indexOf('<form '),'no form nested in link');
  assert.doesNotMatch(jobsOverviewPage(jobs),/job-cancel-form/);
  assert.doesNotMatch(jobsOverviewPage([{...jobs[0],status:'cancelling'}],'csrf'),/job-cancel-form/);
  assert.doesNotMatch(jobsOverviewPage([jobs[1]],'csrf'),/job-cancel-form/);
});

test('JOB-PROGRESS: model liveness distinguishes worker and Blender and does not invent completion',async()=>{
 const {jobProgress}=await import('../dist/web/project-pages.js');
 const now=new Date('2026-11-23T21:10:00.000Z');
 const running={...jobs[0],progress_phase:'blender_execution',
   started_at:new Date('2026-11-23T21:06:00.000Z'),
   worker_heartbeat_at:new Date('2026-11-23T21:09:50.000Z'),
   blender_heartbeat_at:new Date('2026-11-23T21:07:00.000Z'),
   deadline_at:new Date('2026-11-23T21:25:00.000Z')};
 const text=jobProgress(running,now);
 assert.match(text,/Kör Blender Python/);
 assert.match(text,/Körtid: 4 min/);
 assert.match(text,/Tidsgräns: 15 min kvar/);
 assert.match(text,/Worker: 10 s sedan/);
 assert.match(text,/Blender: ingen färsk signal/);
 assert.doesNotMatch(text,/\d+%|färdig|progress value|<progress/);
 assert.equal(jobProgress({...running,type:'render'},now),'');
});

test('JOB-PROGRESS: archival phases are historical, missing and unknown phases are safe',async()=>{
 const {jobProgress}=await import('../dist/web/project-pages.js');
 const now=new Date('2026-11-23T21:10:00.000Z');
 const prior={...jobs[0],status:'completed',progress_phase:'revision_commit',
   started_at:new Date('2026-11-23T20:00:00.000Z'),
   finished_at:new Date('2026-11-23T20:07:00.000Z')};
 assert.match(jobProgress(prior,now),/Senaste körinformation/);
 assert.match(jobProgress(prior,now),/Sparar revision/);
 assert.match(jobProgress(prior,now),/Körtid: 7 min/);
 assert.doesNotMatch(jobProgress(prior,now),/Worker:|Blender:|Tidsgräns:/);
 assert.equal(jobProgress({...prior,started_at:null,finished_at:null,progress_phase:null},now),'');
 const injected=jobProgress({...prior,status:'running',progress_phase:'<img src=x onerror=alert(1)>'},now);
 assert.doesNotMatch(injected,/img|onerror|alert/);
 assert.match(injected,/Worker: ingen signal ännu/);
 assert.match(injected,/Blender: ingen signal ännu/);
});

test('JOB-PROGRESS: overview and project history render stored milestone details',()=>{
 const now=new Date();
 const active={...jobs[0],progress_phase:'artifact_transfer',started_at:now,
   worker_heartbeat_at:now,blender_heartbeat_at:now,
   deadline_at:new Date(now.getTime()+60000)};
 const page=jobsOverviewPage([active]);
 assert.match(page,/Överför resultat/);
 assert.match(page,/Worker:/);
 assert.match(page,/Blender:/);
 assert.match(page,/class="job-progress"/);
 const project={id,name:'Katt',description:'',current_revision:2,updated_at:date};
 const history=projectDetailPage(project,[],undefined,undefined,[],[
  {id:model,project_id:id,requested_revision:2,status:'running',note:'Skapa',
   error_message:null,created_at:date,progress_phase:'artifact_validation',
   worker_heartbeat_at:now,blender_heartbeat_at:null,started_at:now}
 ],'history');
 assert.match(history,/Verifierar filer/);
 assert.match(history,/Blender: ingen signal ännu/);
});
