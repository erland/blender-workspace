/** Static, token-free viewer shell. The model is fetched separately through an
 * authenticated, same-origin request tied to the HttpOnly Google session.
 */
export function viewerPage(projectId:string,revision:number):string{
  return `<!doctype html>
<html lang="sv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blender Workspace – 3D-visare</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#eef2f7;color:#172033;font:16px system-ui,sans-serif}
header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:12px 20px;background:#fff;border-bottom:1px solid #cbd5e1}
h1{font-size:1.15rem;margin:0}.actions{display:flex;gap:8px;flex-wrap:wrap}
button{border:1px solid #64748b;background:#fff;border-radius:8px;padding:9px 14px;cursor:pointer}
button:disabled{cursor:default;opacity:.4}
main{height:calc(100dvh - 165px);min-height:320px;padding:12px}
.viewports{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;height:100%}
.viewports:has(#compare-pane:not([hidden])){grid-template-columns:repeat(2,minmax(0,1fr))}
.viewport{min-width:0;min-height:260px}
#compare-pane[hidden]{display:none}
@media(max-width:720px){main{height:auto;min-height:55dvh}.viewports:has(#compare-pane:not([hidden])){grid-template-columns:minmax(0,1fr)}.viewport{height:55dvh}}
.selection-bar{display:flex;flex-wrap:wrap;align-items:center;gap:12px;background:#fff;padding:8px 20px;border-bottom:1px solid #cbd5e1}
select{padding:8px;border:1px solid #64748b;border-radius:8px}
canvas{display:block;width:100%;height:100%;border-radius:12px;touch-action:none}
footer{padding:5px 20px;font-size:.9rem}
</style></head><body>
<header><h1>Blender Workspace · revision ${revision}</h1>
<nav class="actions" aria-label="Visningskontroller">
<button id="reset" disabled>Återställ vy</button>
<button id="snapshot" disabled>Spara bild</button>
<a href="/settings">Kontoinställningar</a>
</nav></header>
<div class="selection-bar"><label for="revision-picker">Jämför med</label>
<select id="revision-picker" disabled><option value="">Ingen jämförelse</option></select>
<span id="selected" role="status">Inget objekt markerat</span>
<button id="copy-selection" disabled>Kopiera objektreferens</button>
</div>
<main><div class="viewports"><div class="viewport"><canvas id="viewport" aria-label="Interaktiv 3D-modell för aktuell revision"></canvas></div>
<div class="viewport" id="compare-pane" hidden><canvas id="comparison-viewport" aria-label="Interaktiv 3D-modell för jämförd revision"></canvas></div>
</div></main>
<footer><span id="status" role="status" aria-live="polite">Laddar modell…</span> · <span id="comparison">Ingen jämförelse</span></footer>
<script type="module" src="/viewer/assets/viewer.js"></script>
</body></html>`;
}
