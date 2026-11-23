import {themeStyles,themedCss,componentStyles} from './theme.js';
import {escapeHtml} from './project-pages.js';

export interface ShareRenderImage {
 id:string;engine:string;width:number;height:number;created_at:Date;
}
export function publicSharePage(token:string,projectName:string,revision:number,
 renders:ShareRenderImage[]=[],allowDownload=false,needsZip=false):string {
  const title=escapeHtml(projectName);
  // Called only after token has been verified by the repository.
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>${title} – Publik 3D-modell – Blender Workspace</title>
<style>${themeStyles}${themedCss(`
*{box-sizing:border-box}
body{margin:0;background:#eef2f7;color:#172033;font:16px system-ui,sans-serif;line-height:1.5}
header{background:#fff;padding:16px max(16px,calc((100% - 1100px)/2));border-bottom:1px solid #cbd5e1}
h1{font-size:clamp(1.2rem,3vw,1.7rem);margin:0;overflow-wrap:anywhere}
header p{margin:5px 0 0;color:#475569;font-size:.92rem}
main{max-width:1100px;margin:16px auto;padding:0 14px 36px}
section{background:#fff;border:1px solid #cbd5e1;border-radius:14px;padding:12px}
#public-viewport{width:100%;height:clamp(300px,65dvh,700px);display:block;touch-action:none;border-radius:10px}
.controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0}
label{display:inline-flex;gap:7px;align-items:center}
button,select{font:inherit;min-height:44px;border:1px solid #64748b;border-radius:9px;background:white;padding:8px 12px}
button:disabled,select:disabled{opacity:.5}
#animation-controls[hidden]{display:none}
#public-status{display:block;color:#475569;min-height:24px}
.note{color:#475569;font-size:.9rem;margin:12px 2px 0}
.public-gallery{margin-top:16px}
.public-gallery h2{font-size:1.15rem;margin:0 0 12px}
.public-gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr));gap:12px}
.public-gallery a{display:block;padding:7px;border:1px solid #cbd5e1;border-radius:10px;text-decoration:none;color:inherit}
.public-gallery img{display:block;max-width:100%;width:100%;height:175px;object-fit:contain;background:#eef2f7;border-radius:6px}
.public-gallery small{display:block;color:#475569;margin-top:7px}
footer{margin-top:18px;color:#64748b;font-size:.82rem}
`)}${componentStyles}</style></head><body>
<header><h1>${title}</h1><p>Delad Blender-modell · revision ${revision}</p></header>
<main><section aria-label="Publik GLB-visare">
<canvas id="public-viewport" aria-label="Interaktiv tredimensionell modell"></canvas>
<div id="animation-controls" class="controls" hidden>
<label for="public-clip">Animation <select id="public-clip" disabled></select></label>
<button type="button" id="public-play" disabled>Spela</button>
<label for="public-loop"><input id="public-loop" type="checkbox" checked> Upprepa</label>
</div>
<p id="public-status" role="status" aria-live="polite">Laddar modell…</p>
</section>
${renders.length?`<section class="public-gallery" aria-label="Renderade bilder från revision ${revision}">
<h2>Renderade bilder · revision ${revision}</h2><div class="public-gallery-grid">${renders.map(r=>
  `<a href="/share/${token}/renders/${r.id}.png" target="_blank" rel="noopener noreferrer">
<img loading="lazy" decoding="async" src="/share/${token}/renders/${r.id}.png"
 alt="Rendering ${escapeHtml(r.engine)} från revision ${revision}">
<small>${escapeHtml(r.engine)} · ${r.width} × ${r.height}</small></a>`).join('')}
</div></section>`:''}
${allowDownload?`<section class="public-gallery" aria-label="Ladda ned originalmodell">
<h2>Ladda ned Blender-modellen</h2>
<p>${needsZip?'Den här revisionen har separat lagrade texturer. Ladda ned ZIP och packa upp hela katalogen innan scene.blend öppnas i Blender.':'Den här revisionen har inga separat lagrade resurser och kan laddas ned direkt som BLEND.'}</p>
<a href="/share/${token}/scene.${needsZip?'zip':'blend'}" download>Ladda ned ${needsZip?'BLEND + resurser (ZIP)':'BLEND'} · revision ${revision}</a>
</section>`:''}
<p class="note">Rotera med fingret eller musen, zooma med två fingrar eller mushjulet.
Den här länken ger endast visningsåtkomst till revision ${revision} och de renderade
bilder som ägaren uttryckligen har valt. ${allowDownload?'Ägaren tillåter BLEND-nedladdning.':'BLEND-nedladdning är inte tillåten.'}</p>
<footer>Blender Workspace · Publik, skrivskyddad förhandsvisning</footer>
</main><script type="module" src="/share/assets/public-viewer.js"></script></body></html>`;
}

export function ownerSharePage(projectId:string,revision:number,csrf:string,
  status:'none'|'active'|'revoked',newLink?:string,
  candidates:ShareRenderImage[]=[],selectedIds:string[]=[],message?:string,allowDownload=false):string {
  const base='/projects/'+encodeURIComponent(projectId)+'/revisions/'+revision+'/share';
  const active=status==='active';
  const statusLabel=active?'Aktiv publik delning':status==='revoked'?'Delningen är återkallad':'Inte delad ännu';
  // Only the freshly generated link is displayed, never stored in plaintext.
  const link=newLink?`<div class="link"><a href="${escapeHtml(newLink)}" rel="noreferrer noopener"
    target="_blank">${escapeHtml(newLink)}</a></div>
<p>Den här länken visas bara nu. Kopiera eller dela den innan du lämnar sidan.
Om du tappar bort länken kan du skapa en ny, vilket ogiltigförklarar den gamla.</p>`:'';
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><title>Dela revision ${revision} – Blender Workspace</title>
<style>${themeStyles}${themedCss(`
body{font:16px system-ui,sans-serif;line-height:1.5;background:#f4f7fb;color:#172033;max-width:740px;margin:30px auto;padding:0 16px}
main{padding:22px;border:1px solid #d8e2ed;border-radius:14px;background:white}
button{min-height:44px;padding:10px 16px;border:1px solid #2563eb;border-radius:9px;background:#215dd5;color:white;font:inherit;cursor:pointer}
button.secondary{background:white;color:#2054b8}
button:focus-visible,a:focus-visible,select:focus-visible{outline:3px solid #215dd5;outline-offset:2px}
.share-status{background:#eef2f8;border-radius:10px;padding:14px;margin:16px 0}.share-status strong{display:block;color:#172033}
.share-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.share-actions form{margin:0}
.share-settings{display:grid;gap:16px;margin-top:18px}.share-settings section{border:1px solid #d8e2ed;border-radius:12px;padding:16px;min-width:0}
.share-settings h2{margin:0 0 8px;font-size:1.1rem}.share-settings select{min-height:44px;font:inherit;max-width:100%;margin:8px 8px 8px 0}
.share-settings button{margin-top:8px}@media(max-width:520px){body{margin:12px auto;padding:0 10px}main{padding:16px}.share-actions form,.share-actions button{width:100%}.share-settings section{padding:12px}}
.link{padding:12px;border:1px solid #b9cbe7;border-radius:9px;overflow-wrap:anywhere}
p{color:#4b5563}a{color:#2054b8}
form.action-form{display:inline-block;margin:8px 12px 8px 0}
.image-choice{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #d8e2ed;border-radius:10px;margin:8px 0;cursor:pointer}
.image-choice img{width:96px;height:80px;object-fit:contain;background:#eef2f7;border-radius:6px}
.image-choice input{width:24px;height:24px;flex:0 0 auto}
.gallery-select{border-top:1px solid #d8e2ed;margin-top:20px;padding-top:14px}
.gallery-select h2{font-size:1.15rem}
.image-choice span{flex:1}
.status{padding:8px 12px;background:#edf5ff;border-radius:8px}
`)}${componentStyles}</style></head><body><main>
<p><a href="/projects/${encodeURIComponent(projectId)}?view=history">← Till revisionshistoriken</a></p>
<h1>Dela revision ${revision}</h1>
<div class="share-status" role="status"><strong>${statusLabel}</strong><span>${active?'Besökaren kan se den här revisionens 3D-modell. Inställningarna nedan avgör om bilder och originalfilen också är tillgängliga.':status==='revoked'?'Den gamla länken fungerar inte längre. Skapa en ny länk om du vill dela igen.':'Skapa en länk för att låta andra se modellen utan att kunna ändra den.'}</span></div>
${link}
<p class="muted">Delningen är skrivskyddad. Mottagaren kan inte ändra modellen, se andra revisioner eller starta renderingar. Nedladdning är avstängd som standard.</p>
${message==='images_saved'?'<p role="status" class="status">De publika bilderna har uppdaterats. Länken är oförändrad.</p>':
message==='images_error'?'<p role="alert" class="status">Bildurvalet kunde inte sparas. Kontrollera att bilderna är färdiga och tillhör revisionen.</p>':
message==='download_saved'?'<p role="status" class="status">Nedladdningsbehörigheten är uppdaterad.</p>':''}
<div class="share-actions"><form class="action-form" action="${base}" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<input type="hidden" name="action" value="publish">
<button type="submit">${status==='active'?'Skapa ny delningslänk':'Skapa publik delningslänk'}</button></form>
${status==='active'?`<form action="${base}" method="post">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<input type="hidden" name="action" value="revoke">
<button class="secondary" type="submit">Återkalla delningslänken</button></form>`:''}</div>
${active?`<p class="muted"><strong>Mottagaren kan:</strong> Visa 3D-modellen · ${selectedIds.length} valda bilder · ${allowDownload?'Ladda ned modellen':'Inte ladda ned modellen'}.</p>`:''}
<div class="share-settings">
${active?`<section aria-label="Nedladdningsinställningar">
<h2>1. Tillåt nedladdning</h2>
<p>Avstängt som standard. Den här inställningen gäller bara revision ${revision}.
Revisioner med externa bildtexturer erbjuds som ZIP med BLEND och tillhörande resurser. Andra otillgängliga externa beroenden ingår inte.
Avstängning eller återkallning blockerar nya nedladdningar.</p>
<form action="${base}" method="post">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<input type="hidden" name="action" value="download">
<label for="download-permission">Kan mottagaren ladda ned modellen?</label>
<select id="download-permission" name="enabled">
<option value="no" ${allowDownload?'':'selected'}>Nej – endast visning</option>
<option value="yes" ${allowDownload?'selected':''}>Ja – BLEND eller ZIP med texturer</option>
</select>
<button type="submit">Spara nedladdningsbehörighet</button>
</form></section>`:''}
${active?`<section>
<h2>2. Välj vilka bilder som syns</h2>
<p>Välj högst 12 färdiga bilder från revision ${revision}. Bara markerade bilder blir
synliga för mottagaren. Nya renderingar publiceras aldrig automatiskt.</p>
<form action="${base}" method="post">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<input type="hidden" name="action" value="images">
${candidates.length?candidates.map(r=>`<label class="image-choice">
<input type="checkbox" name="imageId" value="${escapeHtml(r.id)}"
 ${selectedIds.includes(r.id)?'checked':''}>
<img loading="lazy" src="/renders/${encodeURIComponent(projectId)}/${r.id}.png"
 alt="Rendering ${escapeHtml(r.engine)} från revision ${revision}">
<span><strong>${escapeHtml(r.engine)}</strong> · ${r.width} × ${r.height}</span>
</label>`).join(''):'<p>Inga färdiga renderingar tillgängliga för revisionen ännu.</p>'}
<button type="submit">Spara publika bilder</button>
</form></section>`:''}</div>
</main></body></html>`;
}
