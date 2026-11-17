# Blender Workspace MCP service

TypeScript/Node 22 MCP service with PostgreSQL project metadata, immutable Blender artifacts, and a separate Modal worker.

**DEV-008 now supports Google login** through a built-in OAuth 2.1 authorization server following the [Agent Workspace](https://github.com/erland/agent-workspace) architecture. Google is only the upstream identity provider; Blender Workspace issues its own access and refresh tokens scoped to this MCP resource.

See [Google login setup](docs/dev-008-google.md) for Google Cloud, Coolify variables, security constraints and verification. The previous [external OAuth mode](docs/dev-008-oauth.md) remains available.

```sh
cd service
npm install
npm run check
DATABASE_URL=... npm run db:migrate
```

Dockerfile: `service/Dockerfile`, build context `service/`. The app is not yet deployed or externally OAuth-verified; production connection to ChatGPT remains blocked pending real identity-provider integration tests. Do not expose development shared-token mode publicly.
