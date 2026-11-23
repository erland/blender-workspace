/** DESIGN-001: one semantic palette for every server-rendered browser surface.
 *
 * Inline the shared stylesheet because our authenticated pages deliberately
 * use a restrictive CSP; no remote fonts, scripts or additional requests.
 *
 * The compatibility mapper is intentionally only for CSS authored by us,
 * never HTML or model/user content. DESIGN-002 may replace legacy CSS literals
 * with tokens directly as each component is consolidated.
 */
export const themeStyles = `
:root{
 color-scheme:light;
 --page:#f4f6fa;
 --surface:#ffffff;
 --surface-raised:#ffffff;
 --surface-muted:#edf1f7;
 --surface-hover:#eaf1fb;
 --text:#19283c;
 --text-muted:#58697d;
 --border:#d5dfeb;
 --border-strong:#8293ad;
 --accent:#245cc9;
 --accent-hover:#1c4caa;
 --accent-soft:#e9f0fc;
 --accent-text:#244e9c;
 --button-text:#ffffff;
 --danger:#a22632;
 --warning-bg:#fff4f2;
 --warning-border:#eeb5ae;
 --shadow:rgba(20,35,61,.17);
 --focus:#2465dc;
}
@media (prefers-color-scheme:dark){
 :root{
  color-scheme:dark;
  --page:#121923;
  --surface:#202b39;
  --surface-raised:#263343;
  --surface-muted:#303e50;
  --surface-hover:#354963;
  --text:#edf2f9;
  --text-muted:#b2c1d3;
  --border:#405064;
  --border-strong:#8295b0;
  --accent:#84abff;
  --accent-hover:#a5c2ff;
  --accent-soft:#2c4264;
  --accent-text:#bad1ff;
  --button-text:#101b2b;
  --danger:#ff9fa5;
  --warning-bg:#462b30;
  --warning-border:#a35e69;
  --shadow:rgba(0,0,0,.45);
  --focus:#a0c2ff;
 }
}
`;

// Light-mode legacy colors, mapped to intentional semantic roles.
// This lets us improve every view together without risky markup changes.
const legacyColors:Record<string,string>={
 '#f4f7fb':'--page','#eef2f7':'--surface-muted',
 '#19263b':'--text','#172033':'--text','#fff':'--surface',
 '#d8e2ed':'--border','#cbd5e1':'--border',
 '#57667b':'--text-muted','#475569':'--text-muted',
 '#4b5563':'--text-muted','#64748b':'--text-muted',
 '#566577':'--text-muted','#215dd5':'--accent',
 '#2054b8':'--accent-text','#2563eb':'--focus',
 '#e5ecf8':'--surface-muted','#f6f8fc':'--page',
 '#7890bd':'--text-muted',
 '#f7faff':'--surface-hover','#e8eefc':'--accent-soft',
 '#244c9c':'--accent-text','#edf1f5':'--surface-muted',
 '#eaf0fb':'--accent-soft','#eef2fa':'--surface-muted',
 '#c9d6e5':'--border','#f1f5ff':'--surface-hover',
 '#182b4840':'--shadow','#edf3fe':'--surface-hover',
 '#edf2f8':'--surface-muted','#f1f4f8':'--surface-muted',
 '#b7c7dc':'--border-strong','#8090a9':'--border-strong',
 '#9a2029':'--danger','#fff4f2':'--warning-bg',
 '#f1b5ae':'--warning-border','#17203330':'--shadow',
 '#e2e8f0':'--border','#b9cbe7':'--border',
 '#edf5ff':'--accent-soft','#bbb':'--border',
 '#ddd':'--border'
};

/** Color conversion runs only over static, trusted stylesheet strings.
 * Keep white text on primary buttons legible in the dark palette.
 */
export function themedCss(css:string):string{
 const mapped=css.replace(/#[0-9a-f]{3,8}\b/gi,hex=>{
  const role=legacyColors[hex.toLowerCase()];
  return role?'var('+role+')':hex;
 });
 return mapped
  .replace(/(background(?:-color)?\s*:\s*)white\b/gi,'$1var(--surface)')
  .replace(/(background(?:-color)?\s*:\s*)#ffffff\b/gi,'$1var(--surface)')
  // Text on active accents must respond to the matching accent shade.
  .replace(/(color\s*:\s*)white\b/gi,'$1var(--button-text)')
  // Default form fields need a coherent foreground when color-scheme changes.
  +'\ninput,textarea,select{background-color:var(--surface);color:var(--text);border-color:var(--border-strong)}'+
  '\n:focus-visible{outline-color:var(--focus)}';
}


/** DESIGN-002: common visual components appended *after* view-local CSS.
 * Shared styling stays static and CSP-compatible. View-specific layout,
 * canvas height, and responsive controls remain owned by each view.
 */
export const componentStyles = `
:root{
 --radius-sm:8px;--radius-md:12px;--radius-lg:16px;
 --space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;
 --space-5:20px;--space-6:24px;
 --font-sm:.875rem;--font-xs:.8rem;
 --elevation:0 8px 28px -16px var(--shadow);
}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
 -webkit-font-smoothing:antialiased}
h1,h2,h3{font-weight:700;letter-spacing:-.025em;color:var(--text)}
h1{line-height:1.18}h2,h3{line-height:1.3}
a{color:var(--accent-text);text-underline-offset:3px}
a:hover{text-decoration-thickness:2px}
:is(a,button,select,input,textarea,summary):focus-visible{
 outline:3px solid var(--focus);outline-offset:3px
}
:is(button,.button){font-family:inherit;font-weight:650;transition:background-color .15s ease,
 border-color .15s ease,box-shadow .15s ease}
:is(.button,button[type="submit"]){min-height:44px;border-radius:var(--radius-sm)}
.button{display:inline-flex;align-items:center;justify-content:center;gap:8px;
 padding:10px 15px;text-align:center;background:var(--accent);color:var(--button-text);
 text-decoration:none;border:1px solid transparent}
.button:hover{background:var(--accent-hover);color:var(--button-text);text-decoration:none}
.button.alt,.button.secondary{background:var(--accent-soft);color:var(--accent-text);
 border-color:var(--border)}
.button.alt:hover,.button.secondary:hover{background:var(--surface-hover);color:var(--text)}
button:not([disabled]){cursor:pointer}
button:disabled,.button[aria-disabled="true"]{opacity:.55;cursor:not-allowed}
:is(.card,.panel,.render-tile,.render-card,.public-gallery a){
 border-color:var(--border);border-radius:var(--radius-lg);background:var(--surface)
}
.card{transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease}
.card:hover{border-color:var(--border-strong);box-shadow:var(--elevation)}
.card:focus-within{box-shadow:0 0 0 2px var(--focus)}
:is(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),select,textarea){
 border:1px solid var(--border-strong);border-radius:var(--radius-sm);
 background:var(--surface);color:var(--text);font:inherit;min-height:44px
}
input[type="checkbox"],input[type="radio"],input[type="range"]{accent-color:var(--accent)}
label{color:var(--text)}
:where(.muted,.small,.card-meta){color:var(--text-muted)}
:is(.revision-menu-items,.header-menu){background:var(--surface-raised);
 border-color:var(--border);box-shadow:var(--elevation);border-radius:var(--radius-md)}
:is(.tag,.status){font-variant-numeric:tabular-nums}
.bw-icon{display:inline-block;flex:none;width:1.15em;height:1.15em;vertical-align:-.15em;
 fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
@media(prefers-reduced-motion:reduce){
 .card,:is(button,.button){transition:none!important}
}
`;
