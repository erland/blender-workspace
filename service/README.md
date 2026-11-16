# Blender Workspace – MCP, PostgreSQL och beständiga artefakter

DEV-003: TypeScript/MCP-HTTP. DEV-004: PostgreSQL-projektmetadata. DEV-005: intern, filbaserad versionslagring. Tjänsten erbjuder fortfarande bara `workspace_status` via MCP: projektfunktioner, OAuth och Modal-jobb orkestreras i senare steg.

## Databas och migrationer
Använd en separat databas och dedikerad användare på befintlig PostgreSQL-server. Kör `npm run db:migrate` efter `npm run build` med `DATABASE_URL` inställt. Migrationer har checksummor, transaktionslås och körs separat från appens start.

## Beständig projektlagring

`LocalArtifactStore` i `src/storage/artifact-store.ts` skriver verifierade och oföränderliga versioner till en persistent volym. Läs [lagringsbeskrivningen](docs/artifact-storage.md) för formaten, begränsningarna, återställning och Coolify-konfiguration. Rekommenderad monteringspunkt är `/data/blender-workspace`, med skrivbehörighet för containerns Node-användare.

OBS: Lagringsklassen är ännu bara ett internt gränssnitt. Kopplingen till PostgreSQL-revisioner och Modal-jobb kommer i DEV-006. Den är ännu inte tillgänglig som MCP-verktyg.

## Verifiering

```bash
cd service
npm install
npm run check
```

GitHub Actions kör lagringens enhetstester och Docker-bygge. PostgreSQL-integrationstester körs i separat workflow med en tillfällig PostgreSQL 16-server.

## Säkerhet

Den befintliga Bearer-token är enbart ett tillfälligt internt skydd. Tjänsten är **inte redo för publik ChatGPT-anslutning** innan OAuth, ägaridentifiering och verktygsåtkomst är implementerade. Lämna inte ut lokala filvägar till okända klienter.
