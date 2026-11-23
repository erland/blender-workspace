# DEV-063 – Helhetsgranskning av separat resurslagring

Granskad kedja: DEV-058–062 och kompletterande projektfunktioner som konsumerar
native BLEND. Resultat gäller koden, testerna och GitHub CI; ingen fakturerbar
Modal-körning eller produktionstest har initierats.

| Område | Kontroller | Bedömning |
| --- | --- | --- |
| Content-addressed storage | SHA-256, atomiskt publicerad immutable blob, kollisionskontroll, symlinkskydd | Implementerat och enhetstestat |
| Revision | Låst manifest, kontroll av alla blobbar före publicering och vid läsning | Implementerat och enhetstestat |
| Modellering | Blender packar och externaliserar PNG/JPEG, revision 2 kan återläsa utan uppladdning | Täcks även av nytt tvårevisions-Blender-test |
| Rendering | Exakt resursuppsättning hämtas och verifieras före Modal; uppackat träds relativa sökvägar används av Blender | Nytt CI-test renderar faktisk reviderad native BLEND med Cycles utan Modal |
| Enkel revisionsnedladdning | BLEND utan externa filer; SHA-verifierad BLEND + resurser som portabel ZIP annars | Testad av owner/public route-tester |
| Publik delning | Token samt explicit allow_download; verifieras på nytt före ZIP-stream | Testad i tidigare PR |
| Helt projektarkiv | V2 ZIP med en kopia av varje blob; import binder varje revision | PostgreSQL-rundtur och feltester från DEV-062 |
| Projektkloning | **Identifierat fel**: tidigare klonade endast native artefakter och tappade texturmanifestet | **Åtgärdat i denna PR**, med klon-/korruptionstester |
| Projektradering | Tar bort projektets revisioner, men inte gemensamma CAS-blobbar | Rätt för bibehållen referenssäkerhet, men innebär ackumulering |
| Garbage collection | Saknas medvetet för att undvika radering av delade resurser | Kvarstår som ett separat, säkerhetskritiskt utvecklingssteg |

## Viktiga kvarvarande begränsningar

1. **Ingen riktig Modal-kedjetest i CI.** Sista kontrollen bör vara en
   manuellt initierad modellering och rendering i Modal med en fakturerbar
   testmodell. Verifiera från ren sandbox att rätt resurs läses.
2. **Resurser utan referenser återvinns inte**: deras data ligger kvar
   efter projekt- och revisionsradering. Säker städning kräver en
   verifierad referensinventering, karantäntid och skydd för pågående
   jobb, importer och delade revisioner. Kör inte automatisk deletion
   baserat endast på en fil som *ser* oanvänd ut.
3. **Modellsammansättning från externberoende BLEND** avvisas före Modal:
   andra modellrevisioners relativa resurskataloger skulle annars kunna
   kollidera. Detta kräver namngiven remapping.
4. **Begränsad externisering**: PNG/JPEG FILE-bilder stöds.
   Procedurmaterial följer native BLEND och vissa andra format packas.
   Sekvenser, extern cache och olösta referenser avvisas.
5. **Nedladdningsformatet är portabel ZIP**, inte en ny BLEND med
   inbäddade texturer. Hela ZIP:en måste extraheras med rätt katalogträd.
6. **Fil- och arkivstorleksgränser** begränsar stora projekt.
   Ett framtida stort-projektläge bör definieras separat; höj inte
   gränser utan resurs-/bombskydd och strömmad hantering.

## Nytt regressionskrav

Klon av en revision med externa texturer måste få samma resource manifest
och samtliga hashar som källan. Källprojektets filer får sedan tas bort utan
att klonen påverkas. Saknade eller korrumperade blobbar ska neka kloning
innan en ny klon synliggörs.
