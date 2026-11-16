# DEV-005 – beständig och versionssäker lagring

## Gränssnitt

`LocalArtifactStore` skriver **internt** till en Coolify persistent volume. Den tar ett projekt-UUID, ett revisionsnummer, ett förväntat föregående revisionsnummer samt en uppsättning lokala källfiler från ett betrott jobb.

- Max 12 filer per revision och 256 MiB per fil.
- Tillåtna filnamn är enkla `.blend`, `.glb` och `.json` (utan katalogseparatorer).
- Alla filer lagras tillsammans med ett manifest som anger bytes och SHA-256.
- `publish` skriver först till stagingkatalog på samma volym och flyttar atomärt till en oföränderlig revisionskatalog när alla filer verifierats.
- En exklusiv filbaserad skrivlåsning och `expectedPreviousRevision` förhindrar samtidiga skrivare och överskrivning.
- `inspect` och `verifiedArtifactPath` kontrollerar integriteten innan en fil lämnas ut till andra interna komponenter.
- Om skrivningen avbryts före publicering tas stagingfilerna bort. Vid processkrasch kan övergivna stagingmappar eller `.publish.lock` behöva administrativ återställning.

Exempel (internt bruk, efter att en Modal-körning hämtat resultatfiler):

```ts
const store = new LocalArtifactStore('/data/blender-workspace');
const manifest = await store.publish({
  projectId: '<project-uuid>',
  revision: 1,
  expectedPreviousRevision: 0,
  artifacts: [
    { name: 'monster.blend', sourcePath: '/tmp/modal/monster_v1.blend' },
    { name: 'monster.glb', sourcePath: '/tmp/modal/monster_v1.glb' }
  ]
});
```

Kataloglayout: `/data/blender-workspace/<project-uuid>/<revision-8-digits>/...`

## Driftsättning i Coolify

Montera en **persistent Docker volume** på `/data/blender-workspace`. Datat måste överleva omstart, ny image och deployment. Använd en skrivbar volym för den icke-privilegierade Node-användaren (UID 1000); hantera volymens ägarskap på hosten. Säkerhetskopiera och återställ PostgreSQL-metadata **tillsammans med** fillagringen. Starta med en enda tjänstinstans per volym; den här låsningen är inte ett distribuerat lås över olika hostar.

## Viktiga gränser

DEV-005 **lagrar inte i PostgreSQL**, exponerar inte filer via MCP och kopplar inte ihop filer + revisionsrad i en transaktion. Databasens `bw_project_revisions` och `bw_projects.current_revision` synkroniseras med filpublicering först i jobborkestreringen (DEV-006). Vid krasch mellan metadata och fillagring krävs återställnings-/avstämningslogik i senare steg. Artefaktlänkar och åtkomstkontroll hör också till senare steg.

Ingen produktionsvolym har monterats eller testats i Coolify i DEV-005. GitHub Actions verifierar persistence across instances med en tillfällig testkatalog men kan inte bevisa att en specifik Coolify-volym är korrekt konfigurerad.
