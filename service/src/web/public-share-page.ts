import {escapeHtml} from './project-pages.js';

export function publicSharePage(token:string,projectName:string,revision:number):string {
  const title=escapeHtml(projectName);
  // Called only after token has been verified by the repository.
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>${title} – Publik 3D-modell – Blender Workspace</title>
<style>
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
footer{margin-top:18px;color:#64748b;font-size:.82rem}
</style></head><body>
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
<p class="note">Rotera med fingret eller musen, zooma med två fingrar eller mushjulet.
Den här länken ger endast visningsåtkomst till revision ${revision}. Renderade bilder
och nedladdning av Blender-originalet publiceras inte i denna version.</p>
<footer>Blender Workspace · Publik, skrivskyddad förhandsvisning</footer>
</main><script type="module" src="/share/assets/public-viewer.js"></script></body></html>`;
}

export function ownerSharePage(projectId:string,revision:number,csrf:string,
  status:'none'|'active'|'revoked',newLink?:string):string {
  const base='/projects/'+encodeURIComponent(projectId)+'/revisions/'+revision+'/share';
  // Only the freshly generated link is displayed, never stored in plaintext.
  const link=newLink?`<div class="link"><a href="${escapeHtml(newLink)}" rel="noreferrer noopener"
    target="_blank">${escapeHtml(newLink)}</a></div>
<p>Den här länken visas bara nu. Kopiera eller dela den innan du lämnar sidan.
Om du tappar bort länken kan du skapa en ny, vilket ogiltigförklarar den gamla.</p>`:'';
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><title>Dela revision ${revision} – Blender Workspace</title>
<style>
body{font:16px system-ui,sans-serif;line-height:1.5;background:#f4f7fb;color:#172033;max-width:740px;margin:30px auto;padding:0 16px}
main{padding:22px;border:1px solid #d8e2ed;border-radius:14px;background:white}
button{min-height:44px;padding:10px 16px;border:1px solid #2563eb;border-radius:9px;background:#215dd5;color:white;font:inherit;cursor:pointer}
button.secondary{background:white;color:#2054b8}
.link{padding:12px;border:1px solid #b9cbe7;border-radius:9px;overflow-wrap:anywhere}
p{color:#4b5563}a{color:#2054b8}
form{display:inline-block;margin:8px 12px 8px 0}
</style></head><body><main>
<p><a href="/projects/${encodeURIComponent(projectId)}?view=history">← Till revisionshistoriken</a></p>
<h1>Dela revision ${revision}</h1>
<p>${status==='active'?'Den här revisionen är tillgänglig via en aktiv publik länk.':
status==='revoked'?'Den tidigare delningslänken är återkallad.':
'Den här revisionen är ännu inte publicerad.'}</p>
${link}
<p>Delningen är skrivskyddad och visar enbart GLB-modellen och dess animationer.
Ingen kan starta en rendering, se andra revisioner eller ladda ned BLEND via denna länk.</p>
<form action="${base}" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<input type="hidden" name="action" value="publish">
<button type="submit">${status==='active'?'Skapa ny delningslänk':'Skapa publik delningslänk'}</button></form>
${status==='active'?`<form action="${base}" method="post">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<input type="hidden" name="action" value="revoke">
<button class="secondary" type="submit">Återkalla delningslänken</button></form>`:''}
</main></body></html>`;
}
