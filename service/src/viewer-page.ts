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
main{height:calc(100dvh - 112px);min-height:320px;padding:12px}
canvas{display:block;width:100%;height:100%;border-radius:12px;touch-action:none}
footer{padding:5px 20px;font-size:.9rem}
</style></head><body>
<header><h1>Blender Workspace · revision ${revision}</h1>
<nav class="actions" aria-label="Visningskontroller">
<button id="reset" disabled>Återställ vy</button>
<button id="snapshot" disabled>Spara bild</button>
<a href="/settings">Kontoinställningar</a>
</nav></header>
<main><canvas id="viewport" aria-label="Interaktiv 3D-modell"></canvas></main>
<footer id="status" role="status" aria-live="polite">Laddar modell…</footer>
<script type="module" src="/viewer/assets/viewer.js"></script>
</body></html>`;
}
