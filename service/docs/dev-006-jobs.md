# DEV-006 – spårbar jobborkestrering

Första kedjan för den **befintliga förutbestämda testfiguren**: skapa projektmetadata → reservera exklusivt jobb → kör Blender via Modal → hämta tre v1-artefakter → publicera immutabel revision på volym → registrera revision och slutfört jobb i en PostgreSQL-transaktion.

## Konsekvens och återhämtning

`bw_jobs` lagrar `pending`, `running`, `needs_recovery`, `completed` eller `failed`. Partiellt unikt index tillåter ett aktivt jobb per projekt. När filpubliceringen lyckats men databaskommittén misslyckas behålls filerna och jobbet markeras `needs_recovery`. Återhämtningen verifierar SHA-256 och avslutar metadata utan att köra Modal igen.

Vid en abrupt krasch kan ett jobb stanna i `running`. Om dess filer finns kan en operatör återställa det; om de saknas krävs separat felhantering. Ingen lease/watchdog eller automatisk omstart finns ännu.

## Worker

`ModalPythonExecutor` startar den beprövade `modal_provider/runner.py` med fasta parametrar. En separat Docker-image i `job-worker/Dockerfile` innehåller Python, Modal SDK och Blender-byggkontexten. Det existerande MCP-API:ets image påverkas inte. Worker exponeras inte på nätverket.

Se [job-worker/README.md](../../job-worker/README.md) för build och drift.

Lagring och databas behöver finnas på samma säkra Coolify-nätverk eller en väl skyddad anslutning. Kör migrationer före körning, skydda Modal-token som secrets, och montera en beständig skrivbar volym för `ARTIFACT_ROOT`.

## Verifieringsgräns

PR-CI kör enhetstester, riktiga PostgreSQL-transaktioner, rollback/felvägar, och bygger både MCP-image och worker-image. Ett separat `workflow_dispatch` (**DEV-006 Modal live**) kör full kedja med ett riktigt Modal-jobb samt en temporär PostgreSQL-instans efter att workflowet mergats till `main`. Detta manuella test är avsiktligt debiterbart och kräver redan konfigurerade `MODAL_TOKEN_ID` och `MODAL_TOKEN_SECRET`.

**DEV-006 är inte helt verifierat förrän den riktiga jobbkedjan passerat.**

## Begränsningar

- Bara revision 1 av det hårdkodade monstret kan skapas. Tidigare `.blend` används ännu inte som input till Modal.
- Ingen publik MCP-jobbhantering eller OAuth-identifierad användare; bara en intern CLI.
- Ägaridentiteten måste anges av en betrodd operatör; annars saknas garanti att projekten isoleras mellan användare.
- Kostnader, schemaläggning, watchdog, färdiga download-länkar och fullständiga driftsrutiner återstår.
