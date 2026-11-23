# DESIGN-003 – Visuell modernisering av 3D-visaren

## Resultat

Visarens befintliga WebGL-motor, renderingsjobb och API:er lämnas orörda.
I stället samlas den interaktiva 3D-ytan och dess primära åtgärder i en
tydlig arbetsyta med en diskret ram, ett gemensamt åtgärdsfält,
revisionsetikett samt konsekvent stil för inställningar,
animationskontroller och renderingshistorik.

Stilreglerna finns i `src/web/viewer-workspace-styles.ts` och använder
de semantiska ljust/mörkt-temavariablerna från DESIGN-001 och de
gemensamma komponentstilarna från DESIGN-002. Nya beroenden,
nätverksresurser, databasmigreringar och Modal-jobb krävs inte.

## Mobil och surfplatta

- iPhone porträtt: canvas prioriteras, knappar har minst 44px tryckyta;
  sekundära kontrollpaneler kommer därefter utan överliggande
  verktygsfält som skymmer modellen.
- iPhone landskap: höjden på arbetsytan hålls inom tillgänglig vyhöjd
  och lämnar plats för åtgärder.
- iPad porträtt: jämförelsevyer staplas i ett kompakt, avgränsat läge.
- iPad landskap/större skärmar: två jämförda revisioner kan visas sida
  vid sida, inom den befintliga kamerarörelselogiken.
- Renderade bilder visas som adaptiva kort med enhetlig bakgrund.
- Dekorativa revisionsetiketter har `pointer-events:none` för att
  inte störa 3D-rotation, touch eller objektmarkering.

## Viktigt

CSS-temat ändrar **inte** Three.js-scenens bakgrund eller belysning;
material- och färgåtergivning hålls stabil när systemet växlar tema.

## Verifiering

Automatiska tester kontrollerar oförändrade WebGL-/verktygs-ID:n,
primära handlingar, ARIA-etiketter, iPhone/iPad-brytpunkter,
jämförelselayout och renderingsträdet. Full CI inkluderar Service,
Blender och Deployment. Verklig visuell Safari-acceptans i båda
orienteringar återstår och bör ingå i DESIGN-004.
