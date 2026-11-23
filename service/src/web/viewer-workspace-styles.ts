/** DESIGN-003 – viewer-only composition; append after the shared component layer.
 * No changes to the WebGL scene, camera, sizing calculations, or event IDs.
 */
export const viewerWorkspaceStyles=`
.viewer-workspace{max-width:1440px;margin:0 auto;padding:14px clamp(10px,2vw,28px) 0}
.viewer-workspace main{padding:0}
.viewer-workspace .viewports{gap:14px}
.viewer-workspace .viewport{position:relative;overflow:hidden;border:1px solid var(--border);
 border-radius:var(--radius-lg);background:var(--surface-muted);
 box-shadow:0 14px 32px -25px var(--shadow)}
.viewer-workspace canvas{border-radius:calc(var(--radius-lg) - 2px)}
.viewer-workspace .viewer-toolbar{border:1px solid var(--border);
 border-radius:var(--radius-md);background:var(--surface-raised);
 margin-top:12px;padding:10px 12px;gap:10px;box-shadow:var(--elevation)}
.viewer-workspace .viewer-toolbar .primary{border-radius:var(--radius-sm);
 background:var(--accent);color:var(--button-text);border-color:var(--accent);
 min-width:0;min-height:44px}
.viewer-workspace .viewer-toolbar .primary:not(:disabled):hover{background:var(--accent-hover)}
.viewer-workspace .viewer-toolbar .icon-button{border-radius:var(--radius-sm);
 display:inline-flex;align-items:center;justify-content:center;min-height:44px;
 min-width:44px;color:var(--text);background:var(--surface);
 border:1px solid var(--border)}
.viewer-workspace .viewer-toolbar .icon-button:not(:disabled):hover{
 background:var(--surface-hover);border-color:var(--border-strong)}
.viewer-workspace .viewer-toolbar .icon-button .bw-icon{width:20px;height:20px}
.viewer-workspace .stage-caption{position:absolute;top:12px;left:12px;z-index:1;
 padding:6px 10px;border-radius:8px;background:var(--surface-raised);
 color:var(--text-muted);box-shadow:var(--elevation);
 border:1px solid var(--border);font-size:.8rem;font-weight:700;
 pointer-events:none;opacity:.93}
.viewer-workspace .stage-caption .bw-icon{vertical-align:-.22em;margin-right:4px}
.viewer-settings,.animation-bar,.selection-bar,.status-line,.render-section{
 max-width:1440px;margin-left:auto;margin-right:auto}
.viewer-settings,.animation-bar,.selection-bar,.status-line{
 border:1px solid var(--border);border-radius:var(--radius-md);
 margin-top:10px;padding:10px 14px;background:var(--surface)}
.viewer-settings{overflow:visible}
.viewer-settings summary{padding:2px 0;gap:8px}
.viewer-settings summary .bw-icon{color:var(--text-muted)}
.viewer-settings[open] summary{border-bottom:1px solid var(--border);margin-bottom:8px}
.animation-bar{row-gap:8px}
.animation-bar[hidden],.selection-bar[hidden]{display:none}
.selection-bar{background:var(--accent-soft)}
.status-line{color:var(--text-muted);font-variant-numeric:tabular-nums}
.render-section{border:1px solid var(--border);border-radius:var(--radius-lg);
 margin-top:12px;margin-bottom:20px;padding:16px;background:var(--surface)}
.render-controls{gap:12px}
.render-controls h2{font-size:1.08rem}
.render-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.render-card{width:auto;min-width:0;border-radius:var(--radius-md);
 background:var(--surface-raised);overflow:hidden}
.render-card img{width:100%;height:128px;object-fit:contain;
 background:var(--surface-muted);border-radius:var(--radius-sm)}
.render-card small{color:var(--text-muted)}
footer{max-width:1440px;margin:0 auto}
@media(max-width:720px){
 .viewer-workspace{padding:6px 8px 0}
 .viewer-workspace .viewports{gap:8px}
 .viewer-workspace .viewport{height:clamp(280px,58dvh,560px);min-height:0}
 .viewer-workspace .viewer-toolbar{margin-top:8px;padding:8px;gap:8px}
 .viewer-workspace .viewer-toolbar .primary{flex:1 1 0;font-size:.92rem}
 .viewer-workspace .stage-caption{top:8px;left:8px;padding:4px 7px;font-size:.73rem}
 .viewer-settings,.animation-bar,.selection-bar,.status-line{margin:8px 8px 0;padding:8px 10px}
 .render-section{margin:8px 8px 16px;padding:12px}
 .render-gallery{grid-template-columns:repeat(auto-fill,minmax(min(100%,115px),1fr));gap:8px}
 .render-card{width:auto;min-width:0}
 .render-card img{height:96px}
}
@media(max-width:720px) and (orientation:landscape){
 .viewer-workspace .viewport{height:clamp(200px,62dvh,420px)}
}
@media(max-width:1024px){
 .viewer-workspace .viewports:has(#compare-pane:not([hidden])){grid-template-columns:minmax(0,1fr)}
 .viewer-workspace .viewports:has(#compare-pane:not([hidden])) .viewport{
  height:clamp(220px,30dvh,390px);min-height:0}
}
`;
