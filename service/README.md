# Blender Workspace – MCP service and PostgreSQL metadata

DEV-003 provides Node.js/TypeScript MCP Streamable HTTP. DEV-004 adds a **database layer** with versioned PostgreSQL migrations and project metadata. No real database connection, project APIs or job scheduling are exposed by the MCP server yet.

## Isolated PostgreSQL database on Coolify

Use your existing PostgreSQL server, but **create a separate database and dedicated application role**. Never use a shared superuser credential for this service.

Example database administration (execute with appropriate admin permissions, not in application CI):
```sql
CREATE ROLE blender_workspace_user LOGIN PASSWORD 'GENERATE_A_LONG_RANDOM_PASSWORD';
CREATE DATABASE blender_workspace OWNER blender_workspace_user;
```
Store `DATABASE_URL` as a secret in Coolify. TLS is recommended across hosts; use the relevant PostgreSQL client SSL configuration. Never commit secrets or log the URL.

## Migrations

From `service/`, with `DATABASE_URL` configured:
```bash
npm install
npm run build
npm run db:migrate
```
For the production image:
```bash
node dist/db/migrate-cli.js
```
Execute migrations once as a **separate deploy task before deploying the updated service**. They are transactional, serialized with a PostgreSQL advisory lock and checksum-verified. Do not edit an applied migration: add a new numbered file instead.

`bw_projects` has owner scope, title, description, timestamps, soft deletion and a current revision number. `bw_project_revisions` stores revision number, note and optional storage prefix, not Blender file contents. All repository reads and writes require an explicit owner key. That key will be derived from validated authentication after OAuth integration; it is not caller-provided through a public API now.

## Verification

GitHub Actions runs all Node unit/MCP tests against a dedicated PostgreSQL 16 service container and validates migration idempotency, project CRUD, cross-owner isolation, concurrent revision numbering and Docker packaging. No production credentials are needed.

```bash
cd service
npm install
npm run check
# Run integration tests with an isolated TEST_DATABASE_URL
```

## Security and remaining scope

The HTTP MCP scaffold uses an internal bearer token and is **not publicly deployable as a ChatGPT connector until OAuth is implemented**. The next step, DEV-005, handles persistent project files. The later job orchestration step connects metadata to Modal. Health endpoints still describe the MCP scaffold, not PostgreSQL availability.
