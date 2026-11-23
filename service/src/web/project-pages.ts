/** Owner-scoped project metadata rendered with escaped HTML. No browser tokens. */
export interface PortalProject {id:string;name:string;description:string;current_revision:number;updated_at:Date}
export interface PortalRevision {revision:number;note:string;artifact_prefix:string|null;created_at:Date;glbAvailable?:boolean;portableStatus?:'complete'|'external'|'unknown';externalCount?:number}
export interface PortalModelJob {id:string;project_id:string;requested_revision:number;status:string;note:string;error_message:string|null;created_at:Date}
export interface PortalJobItem {id:string;project_id:string;project_name:string;type:'model'|'render';revision:number;status:string;created_at:Date;detail:string;error:string|null}
export interface PortalRender {id:string;source_revision:number;engine:string;width:number;height:number;samples:number;status:string;created_at:Date;error_code?:string|null}
export function escapeHtml(v:string):string {
 return v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
const when=(d:Date)=>new Date(d).toLocaleDateString('sv-SE',{year:'numeric',month:'short',day:'numeric',timeZone:'Europe/Stockholm'});
const projectUrl=(id:string)=>'/projects/'+encodeURIComponent(id);
const viewerUrl=(id:string,r:number)=>'/viewer/'+encodeURIComponent(id)+'/revisions/'+r;
const renderUrl=(projectId:string,r:PortalRender)=>
  '/renders/'+encodeURIComponent(projectId)+'/'+encodeURIComponent(r.id)+'.png';
const style=[
'*,*::before,*::after{box-sizing:border-box}',
'body{margin:0;background:#f4f7fb;color:#19263b;font:16px system-ui,sans-serif;line-height:1.5}',
'a{color:#215dd5}a:hover{text-decoration-thickness:2px}',
'header{background:#fff;border-bottom:1px solid #d8e2ed}',
'.bar{max-width:1080px;margin:auto;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}',
'.logo{color:#19263b;font-size:1.12rem;font-weight:750;text-decoration:none}',
'nav{display:flex;gap:20px}nav a{text-decoration:none;color:#57667b}nav a[aria-current=page]{font-weight:700;color:#19263b}',
'main{max-width:1080px;margin:36px auto;padding:0 24px 60px}',
'h1{font-size:clamp(1.8rem,4vw,2.4rem);line-height:1.2;letter-spacing:-.03em;margin:0 0 8px}',
'h2{font-size:1.15rem;margin:0 0 8px}.intro{display:flex;justify-content:space-between;align-items:end;gap:12px;flex-wrap:wrap;margin-bottom:22px}',
'p{margin:0 0 12px}.muted{color:#57667b}.small{font-size:.91rem}',
'.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,285px),1fr));gap:18px}',
'.card,.panel{background:#fff;border:1px solid #d8e2ed;border-radius:14px;overflow:hidden}',
'.illustration{height:115px;background:linear-gradient(130deg,#e5ecf8,#f6f8fc);display:grid;place-items:center;font-size:3rem;color:#7890bd}',
'.project-thumbnails{height:115px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;background:#e5ecf8}',
'.project-thumbnails span{display:block;min-width:0;overflow:hidden;background:#eef2f7}',
'.project-thumbnails img{display:block;width:100%;height:115px;object-fit:contain}',
'.project-thumbnails:has(span:only-child){grid-template-columns:1fr}',
'.project-thumbnails:has(span:nth-child(2):last-child){grid-template-columns:repeat(2,minmax(0,1fr))}',
'.card-body{padding:14px 16px}.card-body h2{overflow-wrap:anywhere;font-size:1.08rem;margin:0 0 6px}',
'.project-card-link{display:block;height:100%;color:inherit;text-decoration:none}',
'.project-card-link:hover{color:inherit;text-decoration:none;background:#f7faff}',
'.project-card-link:focus-visible{outline:3px solid #215dd5;outline-offset:-3px;border-radius:14px}',
'.project-card-link .card-body{display:flex;flex-direction:column;gap:5px}',
'.project-card-link .card-body p{margin:0}',
'.project-card-link .card-meta{font-size:.85rem;color:#57667b}',
'.project-card-link .card-description{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;overflow-wrap:anywhere}',
'.project-card-link .card-title{display:flex;align-items:center;justify-content:space-between;gap:8px}',
'.project-card-link .card-chevron{font-size:1.5rem;font-weight:400;color:#64748b}',
'.project-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
'@media(max-width:560px){main{margin:16px auto;padding:0 14px 32px}.grid{gap:12px}.intro{margin-bottom:14px}.project-thumbnails,.project-thumbnails img{height:100px}}',
'.card-footer{border-top:1px solid #d8e2ed;padding:12px 18px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}',
'.tag{display:inline-block;border-radius:99px;background:#e8eefc;color:#244c9c;padding:3px 10px;font-size:.83rem;font-weight:650}',
'.tag.empty{background:#edf1f5;color:#566577}',
'.button{display:inline-block;padding:9px 14px;background:#215dd5;color:white;border-radius:9px;text-decoration:none;font-weight:650}',
'.button.alt{background:#eaf0fb;color:#2054b8}',
'.panel{padding:22px}.history{list-style:none;padding:0;margin:0}.history li{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;border-top:1px solid #d8e2ed;padding:14px 0}',
'.history li:first-child{border-top:0}.history p{margin:0}.history .muted{overflow-wrap:anywhere}',
'.revision-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.revision-actions .button{min-height:44px;display:inline-flex;align-items:center}',
'.job-list li{display:block;padding:0}.job-list li:first-child{border-top:0}',
'.job-link{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:76px;padding:12px 6px;color:inherit;text-decoration:none}',
'.job-link:hover{background:#f1f5ff;text-decoration:none}.job-link:focus-visible{outline:3px solid #215dd5;outline-offset:-3px;border-radius:8px}',
'.job-main{display:flex;flex-direction:column;min-width:0;gap:2px;overflow-wrap:anywhere}',
'.job-detail{display:block}.job-end{display:flex;align-items:center;gap:10px;flex-shrink:0}',
'.job-arrow{font-size:1.6rem;line-height:1;color:#64748b}',
'.job-archive>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-size:1.1rem;font-weight:700}',
'.job-archive>summary::marker{color:#64748b}.refresh-link{min-height:44px;display:inline-flex;align-items:center}',
'@media(max-width:560px){.job-link{padding:12px 2px;align-items:flex-start}.job-end{gap:6px}.job-end .tag{font-size:.76rem}.job-arrow{font-size:1.4rem}}',
'.render-revision{margin-top:18px}.render-revision:first-child{margin-top:12px}',
'.render-revision h3{font-size:1rem;margin:0 0 10px}',
'.render-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,170px),1fr));gap:12px}',
'.render-tile{border:1px solid #d8e2ed;border-radius:10px;overflow:hidden;min-width:0;background:#fff}',
'.render-thumb{display:flex;align-items:center;justify-content:center;min-height:130px;background:#f1f4f8}',
'.render-thumb img{display:block;width:100%;height:140px;object-fit:contain}',
'.render-tile-details{padding:9px;font-size:.88rem}.render-tile-details p{margin:0 0 3px}',
'.render-tile:focus-within{outline:2px solid #215dd5;outline-offset:2px}',
'.empty-state{text-align:center;padding:48px 22px;border:1px dashed #b7c7dc;border-radius:14px;background:white}',
'.project-header{margin-bottom:16px}.project-header h1{margin-bottom:6px}',
'.project-description{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;overflow-wrap:anywhere}',
'.project-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:16px 0}',
'.project-tab{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80px;gap:5px;padding:10px 6px;border:1px solid #c9d6e5;border-radius:12px;background:#fff;text-decoration:none;color:#19263b;text-align:center;font-size:.95rem;font-weight:650}',
'.project-tab:hover{background:#f1f5ff;text-decoration:none}.project-tab:focus-visible{outline:3px solid #215dd5;outline-offset:2px}',
'.project-tab[aria-current="page"]{background:#eaf0fb;border-color:#215dd5}',
'.project-tab .tab-icon{font-size:1.4rem;line-height:1.1}',
'.project-settings-link{display:inline-flex;align-items:center;min-height:44px;padding:8px 12px;border-radius:8px;font-size:.92rem}',
'.overview-images{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0}',
'.overview-image{display:block;min-width:0;overflow:hidden;background:#f1f4f8;border-radius:9px}',
'.overview-image img{display:block;width:100%;aspect-ratio:4/3;object-fit:contain}',
'.project-section-heading{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}',
'.project-section-heading a{padding:8px 2px;min-height:44px;display:inline-flex;align-items:center}',
'@media(max-width:560px){.project-tab{min-height:76px}.project-tab .tab-icon{font-size:1.3rem}.project-header{margin-bottom:8px}.panel{padding:16px}.overview-images{gap:6px}}',
'.breadcrumb{margin-bottom:20px}',
'.form-row{display:flex;align-items:end;gap:12px;flex-wrap:wrap}.form-row label{flex:1;min-width:220px;font-weight:600}',
'input[type=text],textarea{display:block;width:100%;margin-top:6px;padding:10px 12px;border:1px solid #8090a9;border-radius:8px;font:inherit}',
'textarea{min-height:96px;resize:vertical}',
'button{font:inherit;border:0;cursor:pointer}.button.alt{color:#2054b8}',
'.danger{color:#9a2029}.danger-button{background:#9a2029;color:white}',
'.warning{padding:16px;background:#fff4f2;border:1px solid #f1b5ae;border-radius:9px;margin-bottom:20px}',
'.actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center}',
'select{display:block;margin-top:6px;padding:10px 12px;border:1px solid #8090a9;border-radius:8px;background:white;font:inherit;max-width:100%}',
'@media(max-width:560px){main{padding:0 18px 40px}.bar{padding:14px 18px}nav{gap:12px}}'
].join('');
function layout(title:string,body:string,liveUpdates=false):string {
 return '<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
 '<title>'+escapeHtml(title)+' – Blender Workspace</title>'+'<style>'+style+'</style></head><body>'+
 '<header><div class="bar"><a class="logo" href="/">◈ Blender Workspace</a>'+
 '<nav aria-label="Huvudnavigering"><a href="/">Projekt</a><a href="/jobs">Jobb</a><a href="/settings">Modal-inställningar</a></nav></div></header>'+
 '<main>'+body+'</main>'+(liveUpdates?'<script src="/portal/assets/live-status.js" defer></script>':'')+'</body></html>';
}
const activeStatus=(status:string)=>status==='pending'||status==='running';
const statusLabels:Record<string,string>={
 pending:'I kö',running:'Körs',completed:'Slutfört',failed:'Misslyckades',
 needs_recovery:'Kräver åtgärd'
};
function jobRow(job:PortalJobItem,linked=true):string {
 const status=statusLabels[job.status]??'Okänd status';
 const destination=projectUrl(job.project_id)+(job.type==='render'?'?view=images':'?view=history');
 const safeError=job.error?'<p class="danger small" role="status">'+escapeHtml(job.error)+'</p>':'';
 const category=job.type==='model'?'Modellering':'Rendering';
 const warning=job.status==='failed'||job.status==='needs_recovery';
 // The entire job entry is one accessible link, with no duplicate "Visa..." action.
 return '<li class="job-item">'+(linked?
   '<a class="job-link" href="'+destination+
   '" aria-label="Visa '+category.toLowerCase()+' för '+escapeHtml(job.project_name)+
   ', revision '+job.revision+', '+escapeHtml(status)+'">':
   '<div class="job-link job-static">')+
   '<span class="job-main"><strong>'+escapeHtml(job.project_name)+'</strong>'+
   '<span class="muted small">'+category+' · revision '+job.revision+'</span>'+
   '<span class="muted small job-detail">'+escapeHtml(job.detail)+' · '+when(job.created_at)+'</span>'+
   safeError+'</span>'+
   '<span class="job-end"><span class="tag'+(warning?' empty':'')+'">'+
     escapeHtml(status)+'</span><span class="job-arrow" aria-hidden="true">›</span></span>'+
   (linked?'</a>':'</div>')+'</li>';
}
export function jobsOverviewPage(items:PortalJobItem[]):string {
 const active=items.filter(x=>activeStatus(x.status));
 const attention=items.filter(x=>x.status==='failed'||x.status==='needs_recovery');
 const complete=items.filter(x=>!activeStatus(x.status)&&x.status!=='failed'&&x.status!=='needs_recovery');
 const section=(jobs:PortalJobItem[],empty:string)=>jobs.length
   ?'<ul class="history job-list">'+jobs.map(j=>jobRow(j)).join('')+'</ul>'
   :'<p class="muted">'+empty+'</p>';
 return layout('Jobb','<div class="intro"><div><h1>Jobb</h1>'+
   '<p class="muted small">Modellering och rendering · senaste 50 jobben per typ</p></div>'+
   '<a class="button alt refresh-link" href="/jobs">Uppdatera</a></div>'+
   '<p id="live-update-message" class="muted small" role="status" aria-live="polite">Jobbstatus uppdateras automatiskt utan att sidan laddas om.</p>'+
   '<div id="live-job-sections"><section class="panel"><h2>Pågående jobb ('+active.length+')</h2>'+
   section(active,'Inga jobb pågår.')+'</section>'+
   (attention.length?'<section class="panel" style="margin-top:16px">'+
     '<h2>Kräver uppmärksamhet ('+attention.length+')</h2>'+
     section(attention,'')+'</section>':'')+'</div>'+
   '<details id="live-job-archive" class="panel job-archive" style="margin-top:16px"'+
     (active.length===0&&attention.length===0?' open':'')+'>'+
     '<summary>Avslutade jobb ('+complete.length+')</summary><div id="live-job-completed">'+
     section(complete,'Inga avslutade jobb.')+'</div></details>',true);
}
export function projectIndexPage(items:{project:PortalProject;revisions:PortalRevision[];renders?:PortalRender[]}[],message?:string,csrf?:string):string {
 const cards=items.map(({project:p,revisions,renders=[]})=>{
  const latest=revisions.filter(r=>r.artifact_prefix&&r.revision<=p.current_revision).at(-1);
  const description=p.description?'<p class="card-description muted">'+escapeHtml(p.description)+'</p>':'';
  const meta=latest?'Senaste revision '+latest.revision:'Ingen sparad modell';
  const recent=renders.filter(r=>r.status==='completed').slice(0,3);
  const thumbnails=recent.length
    ?'<div class="project-thumbnails" aria-hidden="true">'+recent.map(r=>{
       const src=renderUrl(p.id,r);
       return '<span><img loading="lazy" decoding="async" src="'+src+
         '" alt=""></span>';
     }).join('')+'</div>'
    :'<div class="illustration" aria-hidden="true">⬡</div>';
  return '<article class="card"><a class="project-card-link" href="'+projectUrl(p.id)+
    '" aria-label="Öppna projekt '+escapeHtml(p.name)+'">'+thumbnails+
    '<div class="card-body"><h2 class="card-title"><span>'+escapeHtml(p.name)+
    '</span><span class="card-chevron" aria-hidden="true">›</span></h2>'+
    description+'<p class="card-meta">'+meta+' · Ändrad '+when(p.updated_at)+
    '</p></div></a></article>';
 }).join('');
 const listing=cards?'<div class="grid">'+cards+'</div>':
  '<div class="empty-state"><h2>Inga projekt ännu</h2><p class="muted">Skapa en modell med Blender Workspace i ChatGPT. Den visas sedan här.</p></div>';
 return layout('Mina projekt','<div class="intro"><div><h1>Mina projekt</h1>'+
  '<p class="muted small">'+items.length+' projekt'+(items.length===100?' (högst 100 visas)':'')+'</p></div>'+
  (csrf===undefined?'':'<div class="actions"><a class="button alt" href="/models/import">Importera 3D-modell</a><a class="button alt" href="/projects/import">Importera projekt</a></div>')+
  '</div>'+
  (message==='cleanup'?'<p class="warning" role="status">Projektet har dolts medan den permanenta borttagningen slutförs. Filstädningen försöks automatiskt igen om något gick fel.</p>':'')+
  listing);
}
/** Secondary archive import task, kept off the main project browsing screen. */
export function projectImportPage(csrf:string):string {
 return layout('Importera projekt','<div class="breadcrumb"><a href="/">← Mina projekt</a></div>'+
   '<section class="panel"><h1>Importera projekt</h1>'+
   '<p class="muted">Återställ ett tidigare exporterat .bwproject.zip-arkiv. Ett nytt projekt skapas utan att köra Blender.</p>'+
   '<form id="import-project-form"><input type="hidden" name="csrf" value="'+escapeHtml(csrf)+'">'+
   '<label for="archive-file">Projektarkiv (.bwproject.zip)</label> '+
   '<input id="archive-file" name="archive" type="file" accept=".zip,.bwproject.zip" required> '+
   '<button class="button" type="submit">Importera projekt</button>'+
   '<p id="archive-result" role="status" aria-live="polite"></p></form></section>'+
   '<script src="/archive/assets/import.js" defer></script>');
}

/** All completed renders use the same owner-protected PNG endpoint, independent
 * of whether the job was requested from the project page or GLB viewer. */
function projectRenderHistory(projectId:string,renders:PortalRender[]):string {
 if(!renders.length)return '<p class="muted">Inga renderingar ännu.</p>';
 const byRevision=new Map<number,PortalRender[]>();
 for(const render of renders){
   const items=byRevision.get(render.source_revision)??[];
   items.push(render);
   byRevision.set(render.source_revision,items);
 }
 return [...byRevision.entries()].sort((a,b)=>b[0]-a[0]).map(([revision,items])=>
   '<section class="render-revision" aria-label="Renderingar för revision '+revision+'">'+
   '<h3>Revision '+revision+'</h3><div class="render-gallery">'+items.map(r=>{
     const engine=escapeHtml(r.engine==='CYCLES'?'Cycles':'Eevee');
     const state=escapeHtml(statusLabels[r.status]??'Okänd status');
     const metadata=engine+' · '+r.width+' × '+r.height+' · '+r.samples+' samples';
     const imageUrl=renderUrl(projectId,r);
     const visual=r.status==='completed'
       ?'<a class="render-thumb" href="'+imageUrl+'" target="_blank" rel="noopener" aria-label="Öppna PNG för revision '+
         revision+', '+metadata+'"><img loading="lazy" decoding="async" src="'+imageUrl+
         '" alt="Rendering för revision '+revision+'" width="'+r.width+'" height="'+r.height+'"></a>'
       :'<div class="render-thumb"><span class="tag'+
         (r.status==='failed'||r.status==='needs_recovery'?' empty':'')+
         '" role="status">'+state+'</span></div>';
     return '<article class="render-tile">'+visual+
       '<div class="render-tile-details"><p>'+metadata+'</p>'+
       '<p class="muted">'+state+' · '+when(r.created_at)+'</p>'+
       (r.error_code?'<p class="danger">'+escapeHtml(r.error_code)+'</p>':'')+
       '</div></article>';
   }).join('')+'</div></section>'
 ).join('');
}
/** Views are server-rendered to keep iPhone navigation fast, accessible and JS-free. */
export type ProjectView='overview'|'images'|'history'|'settings';
export function projectDetailPage(
 p:PortalProject,revs:PortalRevision[],csrf?:string,message?:string,
 renders:PortalRender[]=[],modelJobs:PortalModelJob[]=[],view:ProjectView='overview'
):string {
 const base=projectUrl(p.id);
 const latest=revs.filter(r=>r.artifact_prefix&&r.revision<=p.current_revision).at(-1);
 const latestView=latest?.glbAvailable!==false&&latest?viewerUrl(p.id,latest.revision):null;
 const imagesUrl=base+'?view=images',historyUrl=base+'?view=history',settingsUrl=base+'?view=settings';
 const history=[...revs].sort((a,b)=>b.revision-a.revision).map(r=>{
   const saved=Boolean(r.artifact_prefix);
   const status=saved?'<span class="tag">Sparad</span>':'<span class="tag empty">Ej tillgänglig</span>';
   const open=saved&&r.glbAvailable!==false?
     '<a class="button alt" href="'+viewerUrl(p.id,r.revision)+'">Visa GLB</a>':'';
   const download=saved?
     '<a class="button alt" href="'+base+'/revisions/'+r.revision+
     '/download" download>⬇ Ladda ned BLEND</a>':'';
   const portability=!saved?'':r.portableStatus==='complete'
     ?'<span class="muted small">Kända externa resurser inpackade</span>':
     r.portableStatus==='external'
       ?'<span class="muted small" role="note">⚠ '+(r.externalCount??0)+
        ' externa filberoenden återstår – lokal rendering kan sakna resurser</span>'
       :'<span class="muted small">Externa resurser ej verifierade för denna revision</span>';
   return '<li><div><p><strong>Revision '+r.revision+'</strong> '+status+'</p>'+
     '<p class="muted small">'+escapeHtml(r.note||'Ingen beskrivning')+' · '+when(r.created_at)+
     '</p>'+portability+'</div>'+
     (saved?'<div class="revision-actions">'+open+download+'</div>':'')+'</li>';
 }).join('');
 const tab=(title:string,icon:string,url:string,selected:boolean)=>
   '<a class="project-tab" href="'+url+'"'+(selected?' aria-current="page"':'')+'>'+
   '<span class="tab-icon" aria-hidden="true">'+icon+'</span>'+title+'</a>';
 const tabs='<nav class="project-tabs" aria-label="Projektets funktioner">'+
   (latestView?tab('3D-modell','⬡',latestView,false):
    '<span class="project-tab" aria-disabled="true" title="Ingen GLB-modell sparad">'+
    '<span class="tab-icon" aria-hidden="true">⬡</span>3D saknas</span>')+
   tab('Bilder','▧',imagesUrl,view==='images')+
   tab('Historik','◷',historyUrl,view==='history')+'</nav>';
 const intro='<div class="breadcrumb"><a href="/">← Mina projekt</a></div>'+
   '<div class="project-header"><div class="project-section-heading"><h1>'+
     escapeHtml(p.name)+'</h1>'+
     (csrf===undefined?'':'<a class="project-settings-link" href="'+settingsUrl+
       '"'+(view==='settings'?' aria-current="page"':'')+'>⚙ Projektinställningar</a>')+
   '</div>'+
   (p.description?'<p class="muted project-description">'+escapeHtml(p.description)+'</p>':'')+
   '<p class="muted small">Senaste revision '+p.current_revision+' · Ändrad '+when(p.updated_at)+'</p>'+
   (message==='import_queued'?'<p role="status">Importjobbet har lagts i kö. Modellen visas när den nya revisionen är klar.</p>':'')+
   '</div>';
 const latestImages=renders.filter(r=>r.status==='completed').slice(0,3);
 const previews=latestImages.length
   ?'<div class="overview-images">'+latestImages.map(r=>{
     const imageUrl=renderUrl(p.id,r);
     return '<a class="overview-image" href="'+imageUrl+'" target="_blank" rel="noopener"'+
       ' aria-label="Öppna rendering för revision '+r.source_revision+'">'+
       '<img loading="lazy" decoding="async" src="'+imageUrl+'"'+
       ' alt="Rendering för revision '+r.source_revision+'"></a>';
   }).join('')+'</div>'
   :'<p class="muted">Inga sparade renderingar ännu.</p>';
 const overview='<section class="panel"><div class="project-section-heading">'+
   '<h2>Senaste renderingar</h2><a href="'+imagesUrl+'">Visa alla bilder</a></div>'+
   previews+'</section>'+
   (latestView?'<p class="muted small" style="margin-top:14px">GLB är en förenklad förhandsvisning.'+
      ' Blender-originalet kan innehålla hår, material och detaljer som inte syns i 3D-visaren.</p>':'');
 const modelHistory='<section class="panel"><h2>Revisionshistorik</h2>'+
   (history?'<ul class="history">'+history+'</ul>':
     '<p class="muted">Projektet har ännu ingen sparad modell. Skapa en revision via ChatGPT.</p>')+
   '</section><section class="panel" style="margin-top:16px">'+
   '<div class="project-section-heading"><h2>Modelleringsjobb</h2>'+
   '<a href="/jobs">Alla jobb</a></div>'+
   '<div id="live-project-model-jobs">'+(modelJobs.length?'<ul class="history">'+modelJobs.map(j=>jobRow({
     id:j.id,project_id:p.id,project_name:p.name,type:'model',revision:j.requested_revision,
     status:j.status,created_at:j.created_at,detail:j.note||'Blender Python',
     error:j.error_message
   },false)).join('')+'</ul>':'<p class="muted">Inga modelleringsjobb ännu.</p>')+'</div></section>';
 const renderSection=csrf===undefined?'':'<details class="panel" style="margin-bottom:16px"'+
   (message==='render_error'?' open':'')+'><summary style="cursor:pointer;min-height:44px;font-weight:700">Skapa rendering (Modal)</summary>'+
   '<div style="margin-top:12px"><h2>Rendera bild från Blender</h2>'+
   '<p class="muted">Separat betald Modal-körning. Originalet och revisionen ändras inte.</p>'+
   (message==='render_queued'?'<p role="status">Renderingsjobbet har lagts i kö. Uppdatera sidan för att se status.</p>':
    message==='render_error'?'<p role="alert" class="danger">Renderingen kunde inte köas. Kontrollera Modal-koppling och inställningar.</p>':'')+
   (revs.some(r=>r.artifact_prefix)?'<form method="post" action="'+base+'/renders">'+
      '<input type="hidden" name="csrf" value="'+escapeHtml(csrf)+'">'+
      '<div class="form-row"><label>Revision <select name="revision">'+
      revs.filter(r=>r.artifact_prefix).map(r=>'<option value="'+r.revision+'"'+
        (r.revision===p.current_revision?' selected':'')+'>Revision '+r.revision+'</option>').join('')+
      '</select></label><label>Motor <select name="engine">'+
      '<option value="BLENDER_EEVEE_NEXT">Eevee (snabb)</option>'+
      '<option value="CYCLES">Cycles (högre kvalitet)</option></select></label>'+
      '<label>Storlek <select name="size"><option value="256">256 × 256</option>'+
      '<option value="512" selected>512 × 512</option><option value="1024">1024 × 1024</option>'+
      '</select></label><label>Samples <select name="samples"><option value="8">8</option>'+
      '<option value="16" selected>16</option><option value="32">32</option></select></label>'+
      '<button class="button" type="submit">Starta rendering i Modal</button></div></form>':
      '<p class="muted">En sparad revision krävs för rendering.</p>')+
   '</div></details>';
 const imageHistory='<section class="panel" style="margin-top:16px">'+
   '<h2>Renderingsjobb och bilder</h2><div id="live-project-render-jobs">'+
   projectRenderHistory(p.id,renders)+'</div></section>';
 const settings=csrf===undefined?'':'<section class="panel"><h2>Hantera projektet</h2>'+
   (message==='renamed'?'<p role="status">Projektnamnet har uppdaterats.</p>':
    message==='description_updated'?'<p role="status">Projektbeskrivningen har uppdaterats.</p>':
    message==='description_invalid'?'<p role="alert" class="danger">Beskrivningen får vara högst 5 000 tecken.</p>':
    message==='invalid'?'<p role="alert" class="danger">Ange ett projektnamn med 1–200 tecken.</p>':
    message==='error'?'<p role="alert" class="danger">Projektet kunde inte uppdateras.</p>':'')+
   '<form method="post" action="'+base+'/rename">'+
   '<input type="hidden" name="csrf" value="'+escapeHtml(csrf)+'">'+
   '<div class="form-row"><label for="project-name">Projektnamn'+
   '<input id="project-name" type="text" name="name" value="'+escapeHtml(p.name)+
   '" required maxlength="200"></label>'+
   '<button class="button" type="submit">Byt namn</button></div></form>'+
   '<form method="post" action="'+base+'/description" style="margin-top:18px">'+
   '<input type="hidden" name="csrf" value="'+escapeHtml(csrf)+'">'+
   '<label for="project-description">Projektbeskrivning'+
   '<textarea id="project-description" name="description" maxlength="5000">'+
   escapeHtml(p.description)+'</textarea></label>'+
   '<button class="button" type="submit" style="margin-top:10px">Spara beskrivning</button></form>'+
   '<p style="margin-top:20px"><a class="button alt" href="'+base+'/export">Exportera projekt (ZIP)</a></p>'+
   '<p style="margin-top:20px"><a class="danger" href="'+base+'/delete">Ta bort projektet…</a></p>'+
   '</section>';
 const body=view==='images'?renderSection+imageHistory:
   view==='history'?modelHistory:view==='settings'?settings:overview;
 // Live changes are confined to job/image containers. User input, any open
 // rendering form and the page scroll remain untouched.
 return layout(p.name,intro+tabs+body,
   view==='history'||view==='images');
}

/** Deliberate separate confirmation step. A GET can never delete a project. */
export function projectDeletePage(p:PortalProject,csrf:string,message?:string):string{
 const path=projectUrl(p.id);
 const warning=message==='busy'
   ?'<p role="alert" class="warning">Projektet har ett aktivt eller återställningskrävande jobb och kan inte tas bort.</p>'
   :message==='error'?'<p role="alert" class="warning">Projektet kunde inte tas bort. Försök igen.</p>':'';
 return layout('Bekräfta borttagning','<div class="breadcrumb"><a href="'+path+'">← Tillbaka till projektet</a></div>'+
  '<section class="panel"><h1>Ta bort projekt?</h1>'+
  warning+'<p>Du är på väg att permanent ta bort <strong>'+escapeHtml(p.name)+'</strong> från din projektlista.</p>'+
  '<p class="muted">Projektet, alla revisioner, sparade modellfiler och jobbhistorik raderas permanent. Åtgärden kan inte ångras. Exportera projektet och kontrollera att arkivet kan importeras innan du raderar originalet.</p>'+
  '<form method="post" action="'+path+'/delete">'+
  '<input type="hidden" name="csrf" value="'+escapeHtml(csrf)+'">'+
  '<label><input name="confirm" type="checkbox" value="yes" required> Ja, ta bort detta projekt</label>'+
  '<div class="actions" style="margin-top:18px"><button class="button danger-button" type="submit">Radera permanent</button>'+
  '<a class="button alt" href="'+path+'">Avbryt</a></div></form></section>');
}

/** Owner-authenticated upload and explicit paid model composition. */
export function modelImportPage(csrf:string,
 uploads:{id:string;filename:string;format:string;size_bytes:number}[],
 projects:{id:string;name:string;current_revision:number}[],message?:string):string{
 const modelUploads=uploads.filter(u=>u.format==='blend'||u.format==='glb');
 const textureUploads=uploads.filter(u=>u.format==='png'||u.format==='jpg');
 const options=modelUploads.map(u=>'<option value="'+escapeHtml(u.id)+'">'+
   escapeHtml(u.filename)+' ('+u.format.toUpperCase()+', '+
   (u.size_bytes/1048576).toFixed(1)+' MiB)</option>').join('');
 const destinations=projects.map(p=>'<option value="'+escapeHtml(p.id)+'">'+
   escapeHtml(p.name)+' – rev '+p.current_revision+'</option>').join('');
 const notification=message==='queued'?'<p role="status">Modellimporten ligger i kön. Revisionen visas när jobbet är klart.</p>':
   message==='error'?'<p role="alert">Importen kunde inte beställas. Kontrollera Modal och projektets revision.</p>':'';
 return layout('Importera 3D-modell',
  '<div class="breadcrumb"><a href="/">← Mina projekt</a></div>'+
  '<h1>Importera 3D-modell</h1><p class="muted">Ladda upp BLEND, GLB, PNG eller JPEG (max 32 MiB). Uppladdningen startar inget Modal-jobb.</p>'+
  notification+
  '<section class="panel" style="padding:20px;margin-top:20px"><h2>1. Ladda upp fil</h2>'+
  '<form id="upload-model-form"><input type="hidden" name="csrf" value="'+escapeHtml(csrf)+'">'+
  '<label for="model-file">Modell eller textur (BLEND, GLB, PNG, JPEG)</label> <input id="model-file" name="model" type="file" required aria-describedby="model-file-help">' +
  '<p id="model-file-help" class="muted small">Välj en .blend-, .glb-, .png-, .jpg- eller .jpeg-fil via Filer. Filtypen kontrolleras efter valet för att även fungera på iPad och iPhone.</p>' +
  '<button class="button" type="submit">Ladda upp</button>'+
  '<p id="model-upload-result" role="status" aria-live="polite"></p></form></section>'+
  '<section class="panel" style="padding:20px;margin-top:20px"><h2>2. Importera till en scen</h2>'+
  (modelUploads.length?'<form method="post" action="/models/compose">'+
   '<input type="hidden" name="csrf" value="'+escapeHtml(csrf)+'">'+
   '<label for="uploaded-model">Sparad modell</label><select id="uploaded-model" name="uploadId" required>'+options+'</select>'+
   '<label for="target-project">Målprojekt</label><select id="target-project" name="projectId">'+
   '<option value="new">Skapa nytt projekt</option>'+destinations+'</select>'+
   '<label for="import-name">Projektnamn (för nytt projekt)</label>'+
   '<input id="import-name" name="name" maxlength="200" value="Importerad 3D-modell">'+
   '<p class="muted small">Import sker vid origo. Vid befintligt projekt skapas nästa revision.</p>'+
   '<label><input type="checkbox" name="confirm" value="yes" required> Jag godkänner en betald Modal-körning för att importera modellen.</label>'+
   '<button class="button" type="submit">Starta import</button></form>':
   '<p class="muted">Ladda upp en modell för att fortsätta.</p>')+
  '</section>'+
  '<section class="panel" style="padding:20px;margin-top:20px"><h2>3. Använd bildtextur på en modell</h2>'+
  '<p class="muted small">Välj en uppladdad PNG/JPEG, befintligt projekt och exakt namn på ett mesh-objekt. En ny revision skapas; texturen packas i BLEND-filen. Objektens namn kan hämtas via sceninspektion.</p>'+
  (textureUploads.length&&projects.some(p=>p.current_revision>0)?
   '<form method="post" action="/models/textures/apply">'+
   '<input type="hidden" name="csrf" value="'+escapeHtml(csrf)+'">'+
   '<label for="texture-upload">Texturbild</label><select id="texture-upload" name="uploadId" required>'+
   textureUploads.map(u=>'<option value="'+escapeHtml(u.id)+'">'+escapeHtml(u.filename)+'</option>').join('')+
   '</select><label for="texture-project">Målprojekt</label><select id="texture-project" name="projectId" required>'+
   projects.filter(p=>p.current_revision>0).map(p=>'<option value="'+escapeHtml(p.id)+'">'+
     escapeHtml(p.name)+' – rev '+p.current_revision+'</option>').join('')+
   '</select><label for="texture-object">Mesh-objektets exakta namn</label>'+
   '<input id="texture-object" name="objectName" type="text" maxlength="200" required placeholder="Exempel: Body">'+
   '<label for="texture-channel">Materialkanal</label><select id="texture-channel" name="channel">'+
   '<option value="baseColor">Färg (Base Color)</option>'+
   '<option value="roughness">Ytråhet (Roughness)</option>'+
   '<option value="metallic">Metallic</option>'+
   '<option value="normal">Normal Map</option></select>'+
   '<label><input type="checkbox" name="confirm" value="yes" required> Jag godkänner en betald Modal-körning för att skapa en texturerad revision.</label>'+
   '<button class="button" type="submit">Applicera textur i ny revision</button></form>':
   '<p class="muted">Ladda upp en PNG/JPEG och skapa eller välj ett projekt med sparad revision först.</p>')+
  '</section><script src="/models/assets/upload.js" defer></script>');
}
