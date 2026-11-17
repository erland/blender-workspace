# Blender Workspace MCP Service

DEV-003–006 established Streamable HTTP, PostgreSQL, immutable artifact storage and a separately hosted Modal job worker. DEV-007 exposes owner-scoped project and job metadata tools through MCP.

See [DEV-007 MCP tools](docs/dev-007-mcp-tools.md) for the seven tools, single-tenant security model, work queue behavior and how to operate the separate worker.

## Local development and tests

```sh
cd service
npm install
npm run check
```

GitHub Actions runs the full HTTP/MCP/TypeScript test suite with PostgreSQL 16 and builds the production Docker image. Migration command: `npm run db:migrate` with `DATABASE_URL` configured.

## Coolify

Set Dockerfile `service/Dockerfile` with build context `service/`. Use a dedicated HTTPS origin and a dedicated PostgreSQL user/database, and configure `PUBLIC_ORIGIN`, `MCP_ACCESS_TOKEN`, `DATABASE_URL` and `MCP_OWNER_KEY` as secrets. Health endpoint: `/health/live`.

**Not publicly connectable to ChatGPT yet.** Bearer auth is temporary and represents a single internal workspace. OAuth, per-user identity, user consent and authorization are required before exposing this externally.

## Storage and worker

The separate Modal worker remains in `job-worker/`. `workspace_queue_demo` only reserves a database job, not a Modal invocation. The current worker supports a trusted `run OWNER JOB_ID` command. There is still no automatic job polling/dispatcher. More general Blender modeling and project revision editing remain subsequent work.
