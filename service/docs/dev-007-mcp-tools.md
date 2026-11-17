# DEV-007 – MCP-verktyg för projekt och jobb (intern single-tenant)

## Avgränsning

Den permanenta MCP-tjänsten exponerar sju nya verktyg mot PostgreSQL:

| Verktyg | Funktion |
| --- | --- |
| `workspace_list_projects` | Lista högst 100 projekt |
| `workspace_create_project` | Skapa ett tomt projekt |
| `workspace_get_project` | Läs ägaravgränsad metadata |
| `workspace_rename_project` | Ändra namn på eget projekt |
| `workspace_list_revisions` | Visa registrerade revisioner |
| `workspace_queue_demo` | Reservera ett demojobb för **revision 1**, status `pending` |
| `workspace_get_job` | Läs status för eget jobb |

MCP-klienten får aldrig ange `ownerKey` eller godtyckliga filvägar/kommandon. Servern använder den **enda interna ägaridentiteten** från `MCP_OWNER_KEY` och verifierar `MCP_ACCESS_TOKEN` före varje MCP-anrop. Repositoryfrågorna är också ägaravgränsade, och svaren innehåller inga lokala filvägar eller databaskopplingsuppgifter.

## Configuration

I Coolify ange via skyddade miljövariabler: `MCP_ACCESS_TOKEN`, `PUBLIC_ORIGIN`, `DATABASE_URL` och `MCP_OWNER_KEY`. Databas och owner måste sättas tillsammans; om båda saknas går endast `workspace_status` att anropa. Kör migrationer i separat steg före appstart.

**Detta är inte OAuth eller en publik multi-tenant-lösning.** Den delade Bearer-token motsvarar en intern identitet i tjänstinstansen. Kör tjänsten med åtkomstkontroller på nätverks-/reverse proxy-nivå fram till DEV-008, och lämna inte ut token till tredje part.

## Köade jobb

`workspace_queue_demo` skapar en rad med status `pending`; det kör inte Blender synkront och anropar inte Modal från HTTP-processen. Workern kan senare hämta ett specifikt reserverat jobb genom sin interna CLI:

```sh
docker run --rm --network <trusted-network> \
  --env-file <worker-secrets> \
  -v <persistent-volume>:/data/blender-workspace \
  blender-workspace-worker:dev006 run <trusted-owner> <job-id>
```

Denna worker kräver `DATABASE_URL`, Modal-token, skrivbar volym och ett betrott owner-värde. Jobbschemaläggning, automatisk worker-dispatch och OAuth hör **inte** till DEV-007; utan operatör eller senare dispatcher förblir jobb `pending`. Kör inte godtycklig användarkod.

## Verifiering

GitHub Actions kör reala MCP-anrop (`tools/list`, `tools/call`) via HTTP mot en PostgreSQL 16-testdatabas och kontrollerar åtkomstnekande, ägarisolering, verktygsscheman, projekthantering och status för köade jobb. Ingen extern Modal-debitering sker i detta steg.
