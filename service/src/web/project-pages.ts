/** Owner-scoped project metadata rendered with escaped HTML. No browser tokens. */
export interface PortalProject {id:string;name:string;description:string;current_revision:number;updated_at:Date}
export interface PortalRevision {revision:number;note:string;artifact_prefix:string|null;created_at:Date}
export function escapeHtml(v:string):string {
 return v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
const when=(d:Date)=>new Date(d).toLocaleDateString('sv-SE',{year:'numeric',month:'short',day:'numeric',timeZone:'Europe/Stockholm'});
const projectUrl=(id:string)=>'/projects/'+encodeURIComponent(id);
const viewerUrl=(id:string,r:number)=>'/viewer/'+encodeURIComponent(id)+'/revisions/'+r;
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
'.card-body{padding:18px}.card-body h2{overflow-wrap:anywhere}.card-body h2 a{text-decoration:none;color:#19263b}',
'.card-footer{border-top:1px solid #d8e2ed;padding:12px 18px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}',
'.tag{display:inline-block;border-radius:99px;background:#e8eefc;color:#244c9c;padding:3px 10px;font-size:.83rem;font-weight:650}',
'.tag.empty{background:#edf1f5;color:#566577}',
'.button{display:inline-block;padding:9px 14px;background:#215dd5;color:white;border-radius:9px;text-decoration:none;font-weight:650}',
'.button.alt{background:#eaf0fb;color:#2054b8}',
'.panel{padding:22px}.history{list-style:none;padding:0;margin:0}.history li{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;border-top:1px solid #d8e2ed;padding:14px 0}',
'.history li:first-child{border-top:0}.history p{margin:0}.history .muted{overflow-wrap:anywhere}',
'.empty-state{text-align:center;padding:48px 22px;border:1px dashed #b7c7dc;border-radius:14px;background:white}',
'.breadcrumb{margin-bottom:20px}',
'.form-row{display:flex;align-items:end;gap:12px;flex-wrap:wrap}.form-row label{flex:1;min-width:220px;font-weight:600}',
'input[type=text]{display:block;width:100%;margin-top:6px;padding:10px 12px;border:1px solid #8090a9;border-radius:8px;font:inherit}',
'button{font:inherit;border:0;cursor:pointer}.button.alt{color:#2054b8}',
'.danger{color:#9a2029}.danger-button{background:#9a2029;color:white}',
'.warning{padding:16px;background:#fff4f2;border:1px solid #f1b5ae;border-radius:9px;margin-bottom:20px}',
'.actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center}',
'@media(max-width:560px){main{padding:0 18px 40px}.bar{padding:14px 18px}nav{gap:12px}}'
].join('');
function layout(title:string,body:string):string {
 return '<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
 '<title>'+escapeHtml(title)+' – Blender Workspace</title><style>'+style+'</style></head><body>'+
 '<header><div class="bar"><a class="logo" href="/">◈ Blender Workspace</a>'+
 '<nav aria-label="Huvudnavigering"><a href="/" aria-current="page">Projekt</a><a href="/settings">Modal-inställningar</a></nav></div></header>'+
 '<main>'+body+'</main></body></html>';
}
export function projectIndexPage(items:{project:PortalProject;revisions:PortalRevision[]}[],message?:string,csrf?:string):string {
 const cards=items.map(({project:p,revisions})=>{
  const latest=revisions.filter(r=>r.artifact_prefix&&r.revision<=p.current_revision).at(-1);
  const description=p.description?'<p class="muted">'+escapeHtml(p.description)+'</p>':'';
  const tag='<span class="tag'+(latest?'':' empty')+'">'+
    (latest?'Senaste revision '+latest.revision:'Ingen sparad modell')+'</span>';
  const viewer=latest?'<a href="'+viewerUrl(p.id,latest.revision)+'">Öppna 3D-vy</a>':'';
  return '<article class="card"><div class="illustration" aria-hidden="true">⬡</div>'+
    '<div class="card-body"><h2><a href="'+projectUrl(p.id)+'">'+escapeHtml(p.name)+'</a></h2>'+
    description+'<p class="muted small">Ändrad '+when(p.updated_at)+'</p>'+tag+'</div>'+
    '<div class="card-footer"><a href="'+projectUrl(p.id)+'">Visa projekt</a>'+viewer+'</div></article>';
 }).join('');
 const listing=cards?'<div class="grid">'+cards+'</div>':
  '<div class="empty-state"><h2>Inga projekt ännu</h2><p class="muted">Skapa en modell med Blender Workspace i ChatGPT. Den visas sedan här.</p></div>';
 return layout('Mina projekt','<div class="intro"><div><h1>Mina projekt</h1>'+
  '<p class="muted">Granska dina sparade Blender-modeller och revisioner. Modellering sker i ChatGPT.</p></div>'+
  '<span class="tag">'+items.length+' projekt'+(items.length===100?' (högst 100 visas)':'')+'</span></div>'+
  (message==='cleanup'?'<p class="warning" role="status">Projektet har dolts medan den permanenta borttagningen slutförs. Filstädningen försöks automatiskt igen om något gick fel.</p>':'')+
  (csrf===undefined?'':'<section class="panel" style="margin-bottom:22px"><h2>Importera projekt</h2>'+
    '<p class="muted">Återställ ett sparat .bwproject.zip-arkiv. Ett nytt projekt skapas utan att köra Blender.</p>'+
    '<form id="import-project-form"><input type="hidden" name="csrf" value="'+escapeHtml(csrf)+'">'+
    '<label for="archive-file">Projektarkiv (.bwproject.zip)</label> '+
    '<input id="archive-file" name="archive" type="file" accept=".zip,.bwproject.zip" required> '+
    '<button class="button" type="submit">Importera</button>'+
    '<p id="archive-result" role="status" aria-live="polite"></p></form></section>')+listing+
    (csrf===undefined?'':'<script src="/archive/assets/import.js" defer></script>'));
}
export function projectDetailPage(p:PortalProject,revs:PortalRevision[],csrf?:string,message?:string):string {
 const latest=revs.filter(r=>r.artifact_prefix&&r.revision<=p.current_revision).at(-1);
 const history=[...revs].sort((a,b)=>b.revision-a.revision).map(r=>{
  const status=r.artifact_prefix?'<span class="tag">Sparad</span>':'<span class="tag empty">Ej tillgänglig</span>';
  const open=r.artifact_prefix?'<a class="button alt" href="'+viewerUrl(p.id,r.revision)+'">Visa i 3D</a>':'';
  return '<li><div><p><strong>Revision '+r.revision+'</strong> '+status+'</p><p class="muted small">'+
    escapeHtml(r.note||'Ingen beskrivning')+' · '+when(r.created_at)+'</p></div>'+open+'</li>';
 }).join('');
 const mainLink=latest?'<a class="button" href="'+viewerUrl(p.id,latest.revision)+'">Öppna senaste modellen</a>':'';
 return layout(p.name,'<div class="breadcrumb"><a href="/">← Alla projekt</a></div><div class="intro">'+
  '<div><h1>'+escapeHtml(p.name)+'</h1><p class="muted">'+escapeHtml(p.description||'Ingen projektbeskrivning angiven.')+
  '</p><p class="muted small">Ändrad '+when(p.updated_at)+' · Aktuell revision '+p.current_revision+'</p></div>'+mainLink+
  '</div><section class="panel"><h2>Revisionshistorik</h2>'+
  (history?'<ul class="history">'+history+'</ul>':
    '<p class="muted">Projektet har ännu ingen sparad modell. Skapa en revision via ChatGPT.</p>')+'</section>'+
  (csrf===undefined?'':'<section class="panel" style="margin-top:18px"><h2>Hantera projektet</h2>'+
    (message==='renamed'?'<p role="status">Projektnamnet har uppdaterats.</p>':
     message==='invalid'?'<p role="alert" class="danger">Ange ett projektnamn med 1–200 tecken.</p>':
     message==='error'?'<p role="alert" class="danger">Projektet kunde inte uppdateras.</p>':'')+
    '<form method="post" action="'+projectUrl(p.id)+'/rename">'+
    '<input type="hidden" name="csrf" value="'+escapeHtml(csrf)+'">'+
    '<div class="form-row"><label for="project-name">Projektnamn'+
    '<input id="project-name" type="text" name="name" value="'+escapeHtml(p.name)+'" required maxlength="200"></label>'+
    '<button class="button" type="submit">Byt namn</button></div></form>'+
    '<p style="margin-top:20px"><a class="button alt" href="'+projectUrl(p.id)+'/export">Exportera projekt (ZIP)</a></p>'+
    '<p style="margin-top:20px"><a class="danger" href="'+projectUrl(p.id)+'/delete">Ta bort projektet…</a></p>'+
    '</section>'));
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
