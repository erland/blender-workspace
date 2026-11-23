# DESIGN-001 – Gemensamt ljus/mörkt systemtema

**Syfte:** Ge Blender Workspace samma färgidentitet i projektportalen, den
inloggade 3D-visaren, de publika förhandsvisningarna, den privata delningsvyn,
inloggningen och Modal-kontoinställningarna.

## Designbeslut

- Systemets `prefers-color-scheme` används automatiskt; ingen manuell
  inställning, localStorage, cookie eller extern skriptfunktion krävs.
- En enda deklaration av semantiska CSS-variabler i `src/web/theme.ts`
  håller både ljus och mörk palett. Den deklareras med `color-scheme`
  så att webbläsarens egna formulärfält och kontroller anpassas.
- Tokens täcker bakgrund, paneler, hover, sekundärtext, fokus, ramar,
  primärhandling, varning, fel och skuggor.
- Arbetsytan i GLB-canvas/3D-rendering förblir separat från webb-UI-temat;
  ingen automatisk ändring av modellens ljussättning eller kamerabild sker.
- En temporär kompatibilitetsadapter `themedCss` mappar gamla statiska
  CSS-färger till semantiska variabler. Konverteringen sker **endast på CSS
  som applikationen själv skriver**, aldrig på modellnamn, användardata,
  bilder, URL:er eller dokument. DESIGN-002 kan gradvis ersätta äldre
  sidors upprepade CSS med gemensamma komponentstilar.

### CSP och drift

Tema-CSS infogas i de existerande serverrenderade `<style>`-blocken.
Därför behövs inte ytterligare nätverksanrop, ny frontendbundler,
externt typsnitt, JavaScript-flagga eller någon förändring av befintlig
Content Security Policy. Inga API-kontrakt eller backendjobb ändras.

### Testning

Node-regressionstest bekräftar att huvudsidorna innehåller samma
systemstyrda färgvariabler samt att de befintliga vyernas färger använder
tokens. Den ordinarie Service/PostgreSQL-, Blender- och Deployment-CI
körs som vanligt.

**Visuell acceptans återstår:** kontrollera Safari iPhone/iPad i båda
orienteringarna samt Mac/Windows. Testa ljust/mörkt systemval,
kontrast, fokus, formulär, överläggsmenyer och att GLB-färgåtergivningen
inte påverkas. Denna PR innehåller inte pixelbaserade skärmbildstester.
