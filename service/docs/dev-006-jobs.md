# DEV-006 – spårbar jobborkestrering

En avgränsad första kedja för den **befintliga förutbestämda testfiguren**: skapa projektmetadata → reservera exklusivt jobb → kör Blender via Modal → hämta tre v1-artefakter → skriv immutabel revision till volym → registrera revision och slutfört jobb i en PostgreSQL-transaktion.

## Konsekvens och återhämtning

`bw_jobs` lagrar status `pending`, `running`, `needs_recovery`, `completed` eller `failed`. Unikt partiellt index tillåter ett aktivt jobb per projekt. Inga artefakter publiceras om en annan revision finns. När filpubliceringen lyckats men databaskommittén misslyckas behålls de immutabla filerna och jobbet markeras `needs_recovery`. `recover` validerar manifest och SHA-256 innan den slutför metadata utan ny Modal-körning.

Vid abrupt processkrasch kan ett jobb vara kvar i `running`. Om dess filer finns går återhämtning; annars krävs operatörsåtgärd. Den första implementationen har ingen lease-/watchdog, och fullständig automatisk återhämtning/övervakning är fortfarande ett senare driftkrav.

## Verklig Modal-exekvering

`ModalPythonExecutor` anropar exakt det beprövade Python-programmet `modal_provider/runner.py` med fasta argument. Det behövs en **separat worker-miljö** med Python 3, Modal SDK och hela repositoryts Blender Docker-kontext. Första versionen exponerar bara en intern CLI; HTTP/MCP-servern får inga nya exekveringsverktyg innan autentisering och tillståndsmodell är klara.

CLI från repo-roten efter installation av Node/Modal och med miljövariablerna `DATABASE_URL`, `ARTIFACT_ROOT`, `MODAL_WORKER_ROOT` (absolut sökväg till repo-roten) och Modal-token:

```bash
cd service && npm install && npm run build && npm run db:migrate
node dist/jobs/cli.js create internal-operator "My cube monster"
node dist/jobs/cli.js recover internal-operator <job-id>
```

Alla kommandon kräver välgrundad intern ägaridentitet från operatör; det finns ingen publik access.

## Begränsningar

- Prototypen kan skapa **första revisionen** från det hårdkodade monsterexemplet. Ändringar av en befintlig `.blend` från valfri tidigare version stöds ännu inte av Modal-runnern.
- Worker-körmiljön ingår inte i tjänstens nuvarande Docker-image; den körs separat. Kravet på en komplett produktionsdistribution med Coolify är därför **inte verifierat** här.
- Ett jobb ägs av den identitet som anroparen har verifierat; `owner` är ännu inte OAuth-bundet.
- Kostnadsdata och fullständig jobbtelemetri lagras ännu inte i databasen; Modal-loggning/rapport finns i DEV-002.
- GitHub Actions verifierar PostgreSQL-transaktioner, fillagring, felvägar och mockad worker, men inte ett riktigt Modal-jobb med den nya orkestreringen. Live-verifiering återstår innan DEV-006 godkänns fullt ut.
