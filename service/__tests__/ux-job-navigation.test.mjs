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
 assert.match(html,/<details class="panel job-archive"/);
 assert.doesNotMatch(html,/<details class="panel job-archive"[^>]* open/);
 assert.doesNotMatch(html,/<meta http-equiv="refresh"/);
 assert.ok(html.includes('/portal/assets/live-status.js'));
});
test('UX-004 finished-only jobs are visible by default and do not auto refresh',()=>{
 const html=jobsOverviewPage([jobs[1]]);
 assert.match(html,/<details class="panel job-archive"[^>]* open/);
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
