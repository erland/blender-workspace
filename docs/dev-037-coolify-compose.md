# DEV-037 — Coolify Compose with external PostgreSQL

Use `deploy/coolify.compose.yaml` as the **Docker Compose** definition
for a Coolify resource. It contains **no PostgreSQL container**. The
PostgreSQL instance is operated separately; it must be reachable from the
Coolify server on a private address/network and must have an existing
`blender_workspace` database and a dedicated login role. Do **not**
point the app at another application's database.

## What is started

1. `migrate` — one-shot container using the same GHCR MCP image, running
   `node dist/db/migrate-cli.js`. The existing SQL migrations create or
   upgrade Blender Workspace tables/indexes and record checksums in
   `bw_schema_migrations`. Migration failures block startup of both
   long-running services. PostgreSQL advisory locks and transactions
   prevent concurrent migration drift.
2. `mcp` — HTTPS-reverse-proxied API on **internal port 3000**, built-in
   Google OAuth, user allowlist and syntax preflight.
3. `job-worker` — no HTTP port exposed; polls the shared PostgreSQL
   database, uses each user's Modal credentials, and reads/writes the
   **same persistent artifacts volume** as MCP.

The one-shot migration is rerun safely on redeployment; it does not
recreate the database or modify other databases. A deployment is not
successful unless migrations succeed. Only the `mcp` service needs a
Coolify domain. Do not publish ports for `job-worker` or `migrate`.

## Coolify: required environment variables

Use Coolify's **Environment Variables** UI for the Compose resource.
Mark passwords/keys as **Secret / masked**, do not paste real values into
the YAML, commit a `.env`, or put the password in a database URL.

| Variable | Example or instruction | Secret? |
| --- | --- | --- |
| `BW_IMAGE_TAG` | Published release version such as `v1.2.3` or `latest` (default) | No |
| `PGHOST` | Internal hostname/IP of the existing PostgreSQL instance | No |
| `PGPORT` | `5432` unless configured otherwise | No |
| `PGUSER` | Dedicated PostgreSQL role for Blender Workspace | No |
| `PGPASSWORD` | Password for this role, entered separately in Coolify | **Yes** |
| `PGDATABASE` | Dedicated existing database, e.g. `blender_workspace` | No |
| `PUBLIC_ORIGIN` | Public HTTPS origin, e.g. `https://blender.example.org` | No |
| `GOOGLE_CLIENT_ID` | OAuth client ID from Google Cloud | No |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret | **Yes** |
| `GOOGLE_ALLOWED_REDIRECT_ORIGINS` | Trusted HTTPS redirect origin(s) used by ChatGPT MCP OAuth clients | No |
| `GOOGLE_ALLOWED_EMAILS` | Comma-separated approved Google addresses, e.g. `a@example.com,b@example.com` | No |
| `OAUTH_SIGNING_KEY` | Base64-encoded Ed25519 PKCS8 DER private signing key | **Yes** |
| `OAUTH_SESSION_SECRET` | Random secret at least 32 characters | **Yes** |
| `MODAL_CREDENTIAL_ENCRYPTION_KEY` | Base64-encoded 32-byte AES encryption key; **same** in MCP and worker | **Yes** |

Never set `DATABASE_URL` in this Compose deployment, and do not mix
`DATABASE_URL` with any `PG*` connection settings. The Node
PostgreSQL driver receives the password as a **separate field**. It is
not embedded into the Compose file or logged as a connection URL.
The `PGPASSWORD` value remains a container environment secret,
visible to privileged container administrators; it is not a filesystem
secret mount.

For a key, generate e.g. `openssl rand -base64 32` for
`MODAL_CREDENTIAL_ENCRYPTION_KEY`. Use a different, cryptographically
random value for `OAUTH_SESSION_SECRET`. Follow
`service/.env.example` for Google OAuth key generation requirements.

**The Google allowlist is a required setting in this Compose file**:
an empty string fails Compose interpolation. Keep it nonempty for the
pilot. Real Google authentication uses the fully verified email claim.

## PostgreSQL prerequisites — one-time DBA setup

Create the **database and role** first, using your existing PostgreSQL
management process. This is the only database-side manual setup. Example
commands for a PostgreSQL administrator, adapting credentials and local
policies:

```sql
CREATE ROLE blender_workspace_app LOGIN PASSWORD 'replace-privately';
CREATE DATABASE blender_workspace OWNER blender_workspace_app;
```

Grant the role the privileges needed to create/alter tables in its own
database schema, and configure authentication/TLS/network rules for
connections from the Coolify host. Run migrations with the same app role
so that later upgrades can alter its objects. If the database uses a
non-default `public` schema policy, grant schema `USAGE` and `CREATE`
there or provision a dedicated schema and set `search_path` accordingly.

The app never creates the PostgreSQL **database** or login **role**:
its migrations create its own **tables, indexes and other schema objects**
inside that database. SQL is transactionally applied and checksummed.

## Deployment procedure

1. Publish a stable GitHub Release (for example `v1.2.3`), verify the release GHCR workflow pushed all three images
   with the same release version tag. Make the Blender package
   publicly readable in GHCR for independent Modal users; configure
   Coolify registry pull credentials for MCP/Worker if those packages
   are private. Confirm the image tag is published before deployment. The worker image pins the Blender image to its matching release version even when `BW_IMAGE_TAG=latest`.
2. Create/verify the separate PostgreSQL database and user, allow network
   access from your Coolify host, and test authentication/TLS as needed.
3. Create a Coolify Docker Compose application from
   `deploy/coolify.compose.yaml`, fill the variables above in Coolify
   and configure the service domain to target **`mcp:3000`** via HTTPS.
   Avoid binding any host ports for the other services.
4. Deploy. Inspect the `migrate` log for `Verified migrations:` and
   a zero exit code. **Do not start or manually bypass** the API/worker
   if migrations fail.
5. Check MCP health and Google OAuth through the public domain; confirm
   a listed Google account can log in and an unlisted account is denied.
   Confirm the worker process is running and connected to the same
   PostgreSQL database/artifact volume.
6. Before billable work, confirm the public Blender GHCR image exists
   and the worker image embeds the matching `MODAL_BLENDER_IMAGE`
   reference. Connect a *personal* Modal account and then deliberately
   run one bounded end-to-end test.

## Updating

Change only `BW_IMAGE_TAG` to a newly published GitHub Release version (or keep `latest` and ensure Coolify pulls the updated image)
and redeploy. The one-shot migrate job applies pending migrations
before either long-running service starts. Backup the existing database
and `artifacts` volume beforehand. Preserve the encryption/signing
keys between upgrades. Avoid redeploys while a Modal job is running;
the job recovery logic intentionally does not blindly retry it.

## What CI verifies vs. what is still manual

CI checks that the Compose config resolves without including PostgreSQL,
the migration gate protects both services, the same shared volume is
mounted, required secrets are referenced, and Node tests accept
discrete `PG*` settings. Full PostgreSQL/MCP regression tests run in CI.
A *separate temporary PostgreSQL service in CI* is only a test fixture,
not part of the deployed Coolify Compose file.

Real deployment to your external PostgreSQL, GHCR registry access,
Google/ChatGPT OAuth and a user-funded Modal run are manual
acceptance tests, not claimed to be verified by unit tests.

## Safari settings form compatibility

Safari may submit a same-origin HTML form with `Origin: null` while
sending `Sec-Fetch-Site: same-origin`. Settings POST routes accept this
**specific** combination, in addition to the exact configured
`PUBLIC_ORIGIN`, but still require a valid signed settings session
and its matching per-session CSRF field. Missing `Origin`, an unrelated
origin, or `Origin: null` with missing/cross-site Fetch Metadata is
rejected. No CORS wildcard or proxy override is needed.

If settings POST still fails with HTTP 403, use browser developer tools
to check the **Origin** and **Sec-Fetch-Site** request headers without
copying cookies, CSRF tokens or Modal credentials into logs or tickets.
