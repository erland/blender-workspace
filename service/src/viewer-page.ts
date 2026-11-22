/** Static, token-free viewer shell. The model is fetched separately through an
 * authenticated, same-origin request tied to the HttpOnly Google session.
 */
export function viewerPage(projectId:string,revision:number):string{
  return `<!doctype html>
<html lang="sv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blender Workspace – 3D-visare</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#eef2f7;color:#172033;font:16px system-ui,sans-serif;line-height:1.45}
button,select,input{font:inherit}
button{border:1px solid #64748b;background:#fff;border-radius:9px;padding:10px 14px;min-height:44px;cursor:pointer}
button:disabled{cursor:default;opacity:.45}
a{color:#2054b8}
a:focus-visible,button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #2563eb;outline-offset:2px}
header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 16px;background:#fff;border-bottom:1px solid #cbd5e1}
h1{font-size:1rem;margin:0;line-height:1.2}
.back-link{display:inline-flex;align-items:center;min-height:44px;gap:5px;white-space:nowrap;text-decoration:none;font-weight:650}
.header-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.header-actions{display:flex;align-items:center;gap:8px}
header details{position:relative}
header summary{list-style:none;cursor:pointer;padding:10px;border:1px solid #cbd5e1;border-radius:9px;min-height:44px;display:flex;align-items:center}
header summary::-webkit-details-marker{display:none}
.header-menu{position:absolute;right:0;top:100%;z-index:10;background:white;border:1px solid #cbd5e1;box-shadow:0 6px 16px #17203330;border-radius:10px;padding:8px;min-width:210px}
.header-menu a{display:block;padding:10px}
main{padding:10px 12px 0}
.viewports{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;height:100%}
.viewports:has(#compare-pane:not([hidden])){grid-template-columns:repeat(2,minmax(0,1fr))}
.viewport{min-width:0;min-height:280px;height:min(62dvh,670px)}
#compare-pane[hidden]{display:none}
canvas{display:block;width:100%;height:100%;border-radius:12px;touch-action:none}
.viewer-toolbar{display:flex;align-items:center;gap:8px;padding:10px 12px;background:white;border-bottom:1px solid #cbd5e1}
.viewer-toolbar .primary{flex:1;background:#2054b8;color:white;border-color:#2054b8;font-weight:650}
.viewer-toolbar .icon-button{flex:0 0 44px;padding:8px}
/* Only animated GLBs reveal this toolbar; static models retain the compact layout. */
.animation-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#fff;padding:8px 12px;border-bottom:1px solid #cbd5e1}
.animation-bar[hidden]{display:none}
.animation-bar select{max-width:min(100%,230px)}
.animation-bar input[type=range]{flex:1 1 130px;min-width:80px;accent-color:#2054b8;min-height:44px}
.animation-bar label{display:inline-flex;gap:6px;align-items:center}
.animation-bar input[type=checkbox]{width:20px;height:20px;accent-color:#2054b8}
.animation-bar output{font-variant-numeric:tabular-nums;white-space:nowrap;color:#475569;font-size:.84rem}
.animation-video{flex:1 1 100%;border-top:1px solid #e2e8f0;padding-top:5px}
.animation-video summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:650}
.animation-video-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:4px 0 8px}
.animation-video-controls label{display:inline-flex;align-items:center;gap:6px}
.animation-video-controls a{display:inline-flex;align-items:center;min-height:44px;
  padding:8px 12px;border:1px solid #2054b8;border-radius:9px;text-decoration:none;font-weight:650}
.animation-video-controls [hidden]{display:none}
#video-status{flex:1 1 100%;white-space:normal}

.viewer-settings{background:#fff;border-bottom:1px solid #cbd5e1;padding:0 12px}
.viewer-settings summary{display:flex;align-items:center;cursor:pointer;min-height:44px;font-weight:600}
.viewer-options{display:flex;flex-wrap:wrap;gap:14px;align-items:center}
.viewer-options label{display:inline-flex;gap:6px;align-items:center;min-height:44px}
.viewer-options input{accent-color:#2563eb;width:20px;height:20px}
.viewer-options select{min-width:120px}
select{padding:8px;border:1px solid #64748b;border-radius:8px;max-width:100%}
.settings-content{padding:8px 0 16px;display:grid;gap:12px}
.settings-compare{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.selection-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;background:#fff;padding:8px 12px}
#selected{overflow-wrap:anywhere}
.selection-bar[hidden]{display:none}
.status-line{padding:9px 12px;font-size:.88rem;background:#fff;color:#475569}
.render-section{background:#fff;border-top:1px solid #cbd5e1;padding:12px}
.render-controls{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.render-controls h2{font-size:1rem;margin:0}
.render-gallery{display:flex;flex-wrap:wrap;gap:10px;padding:12px 0}
.render-card{width:150px;border:1px solid #cbd5e1;border-radius:10px;padding:7px}
.render-card img{display:block;max-width:100%;height:104px;object-fit:contain;background:#f1f4f8}
.render-card small{display:block;color:#475569}
footer{padding:9px 12px;font-size:.88rem;color:#475569}
/* iPad portrait and narrower: compare revisions vertically, without
   pushing primary rendering controls below two full-height canvases. */
@media(max-width:1024px){
 .viewports:has(#compare-pane:not([hidden])){grid-template-columns:minmax(0,1fr)}
 .viewports:has(#compare-pane:not([hidden])) .viewport{
   height:clamp(240px,30dvh,390px);min-height:0
 }
}
@media(max-width:720px){
 header{padding:6px 12px}
 .header-title{font-size:.92rem}
 main{padding:6px 8px 0}
 .viewport{height:clamp(280px,56dvh,560px);min-height:0}
 .viewer-toolbar{padding:8px}
 .animation-bar{gap:6px;padding:8px}
 .animation-bar select{flex:1 1 120px;min-width:0}
 .animation-bar input[type=range]{order:5;flex-basis:100%}
 .render-card{width:calc((100% - 20px)/3);min-width:95px}
 .render-card img{height:92px}
}
/* Specificity deliberately overrides the standard small-screen model height. */
@media(max-width:720px){
 .viewports:has(#compare-pane:not([hidden])) .viewport{
   height:clamp(220px,30dvh,390px);min-height:0
 }
}
</style></head><body>
<header>
 <a class="back-link" href="/projects/${projectId}" aria-label="Tillbaka till projektet">← Projekt</a>
 <h1 class="header-title">3D-visare · revision ${revision}</h1>
 <div class="header-actions"><details><summary aria-label="Fler alternativ">⋯</summary>
  <nav class="header-menu" aria-label="Fler alternativ">
   <a href="/projects/${projectId}?view=images">Projektets bilder</a>
   <a href="/projects/${projectId}?view=history">Projektets historik</a>
   <a href="/settings">Modal-inställningar</a>
   <a href="/">Mina projekt</a>
  </nav></details></div>
</header>
<main><div class="viewports"><div class="viewport"><canvas id="viewport" aria-label="Interaktiv 3D-modell för aktuell revision"></canvas></div>
<div class="viewport" id="compare-pane" hidden><canvas id="comparison-viewport" aria-label="Interaktiv 3D-modell för jämförd revision"></canvas></div>
</div></main>
<div class="viewer-toolbar" role="group" aria-label="Åtgärder för aktuell 3D-vy">
 <button id="render-current-view" class="primary" disabled>Rendera vy (Modal)</button>
 <button id="snapshot" class="icon-button" disabled title="Exportera PNG" aria-label="Exportera PNG">📷</button>
 <button id="reset" class="icon-button" disabled title="Återställ vy" aria-label="Återställ vy">↺</button>
</div>
<div id="animation-bar" class="animation-bar" role="group" aria-label="Animationskontroller" hidden>
 <label for="animation-clip">Animation</label>
 <select id="animation-clip" aria-label="Välj animation"></select>
 <button id="animation-play" aria-label="Spela animation">Spela</button>
 <input id="animation-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Animationsposition">
 <output id="animation-clock" for="animation-seek">0.0 s / 0.0 s</output>
 <label><input id="animation-loop" type="checkbox" checked> Upprepa</label>
 <details id="animation-video" class="animation-video">
  <summary>Exportera video</summary>
  <div class="animation-video-controls">
   <label for="video-format">Format <select id="video-format" aria-label="Videoformat" disabled></select></label>
   <button id="video-start" type="button" disabled>Spela in video (720p)</button>
   <button id="video-cancel" type="button" hidden>Avbryt</button>
   <a id="video-download" hidden>Spara video</a>
   <button id="video-share" type="button" hidden>Dela video</button>
   <output id="video-status" role="status" aria-live="polite">
    720p · 30 fps (målvärde). Upp till 120 sekunder, spelas in i realtid utan Modal-kostnad.
   </output>
  </div>
 </details>
</div>
<details class="viewer-settings" id="viewer-settings">
 <summary>Visningsinställningar</summary>
 <div class="settings-content">
 <div class="viewer-options" role="group" aria-label="Kameravy och modellhjälpmedel">
<label for="view-angle">Kameravy</label>
<select id="view-angle" disabled>
<option value="isometric">Isometrisk</option>
<option value="front">Framifrån</option>
<option value="back">Bakifrån</option>
<option value="left">Vänster</option>
<option value="right">Höger</option>
<option value="top">Ovanifrån</option>
</select>
<label><input type="checkbox" id="show-bounds" disabled> Begränsningsruta</label>
<label><input type="checkbox" id="show-axes" disabled> Koordinataxlar</label>
<label><input type="checkbox" id="show-wireframe" disabled> Trådramsvy</label>
</div>
<div class="settings-compare"><label for="revision-picker">Jämför med</label>
<select id="revision-picker" disabled><option value="">Ingen jämförelse</option></select></div>
</div></details>
<div class="selection-bar" id="selection-bar" hidden>
 <span id="selected" role="status">Inget objekt markerat</span>
 <button id="copy-selection" disabled>Kopiera objektreferens</button>
</div>
<div class="status-line"><span id="status" role="status" aria-live="polite">Laddar modell…</span> · <span id="comparison">Ingen jämförelse</span></div>
<section class="render-section" aria-label="Renderingar för denna revision">
 <div class="render-controls"><h2>Senaste renderingar · revision ${revision}</h2>
 <a href="/projects/${projectId}?view=images">Alla projektets bilder</a></div>
 <p id="render-status" role="status" aria-live="polite">Laddar renderingshistorik…</p>
 <div id="render-history" class="render-gallery"></div>
 <button id="render-show-all" hidden>Visa fler bilder</button>
</section>
<script type="module" src="/viewer/assets/viewer.js"></script>
</body></html>`;
}
