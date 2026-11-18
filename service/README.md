# Blender Workspace MCP service

Blender Workspace uses PostgreSQL for owner-isolated project metadata, encrypted personal Modal credentials, immutable Blender artifacts and Google/OAuth login.

## Current architecture

- [Google login, DEV-008](docs/dev-008-google.md) – code and simulated login tests passed; external Google/ChatGPT acceptance deferred
- [Personal Modal credentials, DEV-009](docs/dev-009-modal-accounts.md) – encrypted personal credentials and Google settings; live Modal billing test deferred
- [Automatic Blender job dispatcher, DEV-010](docs/dev-010-dispatcher.md) – separate continuously running worker, PostgreSQL atomic claim and crash quarantine; no public worker endpoint

Run `npm install && npm run check` from `service/`. Run `npm run db:migrate` after building, before serving requests or starting workers. Use `service/Dockerfile` with `service/` context for the HTTP app and `job-worker/Dockerfile` with repository root context for the dispatcher.

The current demo generates the initial cube-monster revision only. No real Google login or personal Modal sandbox was executed for DEV-010 CI.
