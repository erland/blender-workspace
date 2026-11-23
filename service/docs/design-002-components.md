# DESIGN-002 – Gemensamma visuella komponenter

DESIGN-001 införde ljus/mörk systempalett. DESIGN-002 inför en
återanvändbar, CSP-kompatibel komponentstil som ligger *efter* lokala
sidstilar så att knappar, kort, paneler, fält, text och fokusringar har
samma visuella språk. Ingen ändring av routes, lagring, Modal-jobb,
auth eller API-kontrakt görs.

## Nya gemensamma regler

- Typografisk hierarki med ett systemtypsnitt, genomgående rubrikvikter
  och konsekvent radavstånd. Inga externa fonts hämtas.
- Enhetlig 8/12/16px skala för rundningar, delat utrymmessystem och
  diskreta skuggor för innehållskort och menyer.
- Primära och sekundära knappar delar minsta tryckyta 44px, fokus,
  hover och textkontrast i båda färgtemana.
- Formulärfält, dropdowns, radio/checkbox och fokusmarkeringar får
  sammanhängande färg- och komponentbeteende.
- Kortens visuella signalering är diskret och går inte på bekostnad av
  textens läsbarhet.
- Ett internt typat och **helt statiskt** SVG-ikonbibliotek ersätter
  flera operativsystemberoende tecken i portalnavigation och 3D-visarens
  kamerakontroller. Ikonerna är dekorativa och knapparnas befintliga
  tillgängliga namn behålls.
- Vid `prefers-reduced-motion: reduce` avaktiveras dekorativa
  övergångar. Layouten på iPhone/iPad och viewportens dimensioner
  ändras inte.

## Arkitektur

`src/web/theme.ts` exporterar `componentStyles` som återanvänds av
portal, 3D-visare, publik delning, delningsadministration och
inloggnings-/kontosidor. Komponent-CSS levereras i befintliga
serverrenderade `<style>`-block och kräver inga nätverksanrop eller
CSP-undantag. En liten `src/web/icons.ts` innehåller en
deterministisk SVG-uppsättning utan användardata.

## Begränsningar

Komponentstilarna är en första gemensam grund. Sidornas äldre
layout-CSS finns kvar och kan konsolideras senare utan stor
funktionsrisk. DESIGN-003 behandlar 3D-visarens specifika visuella
hierarki. Färg-, fokus- och gesttest på riktiga Safari/iPhone/iPad
behöver göras separat efter driftsättning; CI gör inte anspråk på
fullständig visuell acceptans.
