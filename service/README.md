# Blender Workspace MCP service

TypeScript/Node 22 MCP service using PostgreSQL for owner-isolated project metadata, immutable Blender artifacts, Google/OAuth identity and a separate Modal worker.

## Current work

- [Google OAuth login – DEV-008](docs/dev-008-google.md), code verified; real Google/ChatGPT/Coolify deployment acceptance deferred
- [Personal Modal accounts – DEV-009](docs/dev-009-modal-accounts.md), account encryption and per-owner worker core; Google-authenticated self-service settings UI and live verification not yet available

```sh
cd service
npm install
npm run check
DATABASE_URL=... npm run db:migrate
```

Build service using `service/Dockerfile` (context `service/`) and one-shot worker using `job-worker/Dockerfile` (repository root context). Do not enable `MODAL_EXECUTION_MODE=legacy` for public or multi-user deployments.
