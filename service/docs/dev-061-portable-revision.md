# DEV-061 – Portabel revisionsnedladdning

En sparad modellrevision kan nu laddas ned även om dess PNG/JPEG-texturer
ligger i det gemensamma SHA-256-biblioteket. Samma paketeringskod används
för inloggad och publik nedladdning.

## Val av fil

- **Inga externa resurser:** `/projects/:id/revisions/:rev/download`
  och `/share/:token/scene.blend` fortsätter erbjuda den oförändrade BLEND.
- **Externa resurser:** inloggad `download` omdirigerar till
  `download.zip`. Publik delningssida visar `scene.zip` i stället för
  `scene.blend` när ägaren uttryckligen har tillåtit nedladdning.
- En ZIP innehåller `scene.blend`, katalogen `resources/`, en maskinläsbar
  verifieringsfil `blender-workspace-resources.json` med SHA-256 för varje
  fil och `README.txt`. Extrahera **hela** ZIP:en till en katalog och
  öppna `scene.blend`; Blender kan sedan använda `//resources/...`.

Detta levererar ett portabelt **BLEND + resurser**-paket, inte en ompackad
BLEND-fil med inbäddade bilder. Att skapa en sådan BLEND kräver ett separat,
isolerat Blender-jobb, och ingår inte i detta steg. Vi använder ZIP för att
undvika betald Modal-rendering enbart för nedladdning.

## Skydd

Ägare autentiseras och kontrolleras mot exakt sparad revision. Offentliga
anrop kräver aktiv token och opt-in `allow_download`; utgångna, roterade
och återkallade länkar avvisas. Inga godtyckliga hash-/filsökvägar kan
efterfrågas. Paketeringen validerar varje originalfil mot revisionsmanifest
och SHA-256, avvisar katalogtraversering, duplicerade filnamn och symlänkar,
samt har begränsning för filantal och storlek. ZIP byggs till en privat
temporär katalog och tas bort när överföringen avslutas.

Källrevisionen, resursbiblioteket och manifestet ändras aldrig. GLB
förblir ett självständigt förhandsvisningsformat.

## Avgränsning

Det här är *revisionsnedladdning*; projektarkivets export/import av hela
projekt med revisionshistorik behöver en egen uppdatering för att
deduplicera resurser i arkivet och återställa manifest vid import.
Projektarkiv med externa resurser fortsätter därför tills vidare att
avvisas i stället för att ge felaktigt kompletta säkerhetskopior.

Inga Modal-jobb körs vid nedladdning. Verifiering med riktiga användare
och Blender efter distribution återstår.
