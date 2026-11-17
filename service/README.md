# Blender Workspace MCP

The service exposes MCP over Streamable HTTP and uses PostgreSQL for project metadata. DEV-008 adds a resource-server OAuth 2.1 mode with JWT validation and per-user owner scoping.

Read [OAuth resource server instructions](docs/dev-008-oauth.md) before configuring an identity provider or publishing any endpoint. This service **does not issue OAuth tokens**. A compatible external authorization server (for example an appropriately configured OpenID Connect provider) is required.

Commands from `service/`:

```sh
npm install
npm run check
DATABASE_URL=... npm run db:migrate
```

For Coolify, use Dockerfile `service/Dockerfile` with build context `service/`, enable HTTPS and set the configuration secrets documented in `docs/dev-008-oauth.md`. The separate Modal worker remains in `job-worker/`.

**Not yet externally end-to-end verified:** The application verifies locally generated signed access tokens and full database isolation in CI, but a real identity provider, consent flow and ChatGPT OAuth redirect still require deployment and tests. Never expose the development-only shared-token mode publicly.
