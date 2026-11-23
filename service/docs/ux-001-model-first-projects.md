# UX-001 – Modellfokuserad projektöversikt och kompakt revisionshistorik

## Syfte
Minska scrollning och antalet konkurrerande åtgärder på mobil, utan att
försämra åtkomsten till funktioner eller ändra revisions-/resursarkitekturen.

## Användarflöde
- Projektets standardvy börjar med **Aktuell modell**, inklusive senaste
  revision, en sparad rendering när en sådan finns, annars ett tydligt
  3D-placeholder, samt direkta länkar till 3D-vy och bilder.
- Nedladdning, delning och historik ligger som tydliga sekundärlänkar.
  När en revision har externa texturer står det **ZIP med texturer**; annars
  **BLEND**. Länken använder samma befintliga nedladdningsroute, med ägar- och
  resursvalidering på serversidan.
- I revisionshistoriken öppnar hela huvudraden 3D-modellen där GLB finns.
  Icke-visningsbara revisioner är synliga men saknar trasig öppnalänk.
  Alternativa åtgärder ligger i en tillgänglig meny med 44px tryckyta och
  fullständigt textalternativ via `aria-label`.
- Inloggnings-/säkerhetskontroller och hämtning/export av original ändras inte.

## Kända gränser
- Om projektet inte har en riktig rendering kan den serverrenderade
  projektsidan bara visa en neutral 3D-placeholder. En WebGL-miniatyr
  skulle kräva klientrendering och utvärderas separat.
- Användaren måste fortfarande välja en modellrevision via Historik
  för att arbeta med en äldre revision.
- Ingen separat visuell skärmbildstest av faktisk iPhone/iPad-webbläsare
  utförs av denna kod-PR; kontrollera vid acceptans i båda orienteringarna.
- Nedladdningsetiketten bygger på sparat resursmanifest. Den är inte
  garanti för semantisk kompatibilitet med en extern Blenderinstallation.

## Verifiering
Node-tester täcker översikt, kompakta historikmenyer, saknad GLB,
resursstyrd ZIP-/BLEND-text samt tidigare ägar-/nedladdningskontroller.
GitHub CI kör Service/PostgreSQL, Blender och Deployment.
