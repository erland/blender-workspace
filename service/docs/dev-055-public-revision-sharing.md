# DEV-055 – Publik, skrivskyddad delning av en revision

## Flöde

1. Ägaren öppnar **Projekt → Historik → Dela revision** för en sparad
   revision vars `scene.glb` går att SHA-256-verifiera.
2. Ägaren väljer **Skapa publik delningslänk**. Publiceringen skapar en
   kryptografiskt slumpad token (32 byte), medan PostgreSQL endast lagrar
   dess SHA-256-hash. Länken visas **en gång**. Den kan kopieras och delas.
3. Mottagaren öppnar `/share/<token>` utan inloggning. En fristående
   Three.js GLB-visare stödjer rotation, zoom på mobil och uppspelning
   av animationer. Modellen hämtas från `/share/<token>/scene.glb`.
4. Ägaren kan **Återkalla delningslänken**. Alla efterföljande URL- och
   GLB-förfrågningar kontrollerar token och returnerar 404 efter återkallning.
   Att skapa en ny länk roterar token och gör den gamla ogiltig.

## Säkerhetsgräns

- Delning låses till **exakt en befintlig, sparad revision**. En senare
  revision publiceras aldrig automatiskt.
- Det finns separata publika GET-rutter med **enbart läsning**. Privata
  projekt- och Viewer-API:er behåller oförändrad ägarkontroll.
- Ägarsidans POST-rutt kräver signerad Google-session, samma origin och
  CSRF-token. Ägar- och revisionskontroll sker innan åtgärd.
- Servern hämtar verifierad, oföränderlig `scene.glb` från revisionens
  originalartefakter, inte en senare utbytt preview.
- Postgres lagrar inte rå token, bara hash. Ägarsidan visar aktuell status
  men kan inte återställa tidigare länktoken. En ny länk roterar den.
- Cache är `no-store`; dokument har `noindex`, CSP, `nosniff` och
  `referrer-policy: no-referrer`. Publicerad modell kan naturligtvis
  kopieras av den som får länken.
- Publika läsningar startar inga Modal-jobb och lämnar inte ut session,
  intern projekt-ID, andra revisioner, Python-kod eller ägarmetadata.
- Tabellen innehåller grund för framtida renderingar och BLEND-nedladdning,
  men dessa behörigheter är **låsta till false** av DB CHECK-villkor
  tills en särskild säkerhetsgranskad migration inför dem.
- Inga `/share/:token/download` eller publika renderingsrutter finns i
  DEV-055. De kommer i DEV-056/057.

## Testning

- PostgreSQL: token lagras endast hashad, ägarisolering, ogiltiga
  revisioner, rotation och återkallning.
- HTTP: publicering kräver ägare/Origin/CSRF, publika sidor utan
  inloggning, skydd mot otillåtna render-/download-URL:er och
  omedelbar återkallning.
- Webbläsare: separat JS-bundle utan ägar- eller Modal-funktioner.
- Manuell acceptans: dela en kort animerad revision, öppna länken i
  privat Safari på iPad/iPhone, testa orbit/zoom/animation, återkalla,
  kontrollera att både sidan och GLB-URL:en därefter ger 404.
