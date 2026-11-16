# DEV-003 – Blender Workspace MCP service

An isolated Fastify + MCP TypeScript SDK v2 scaffold intended for Coolify. Provides **POST /mcp** with Streamable HTTP and one read-only `workspace_status` tool. GET/DELETE /mcp return 405. Unauthenticated clients receive 401; requests with a mismatched Origin receive 403. Public liveness is `/health/live`; readiness is `/health/ready`.

## Local checks

```bash
cd service
npm install
npm run check
MCP_ACCESS_TOKEN="$(openssl rand -hex 32)" PUBLIC_ORIGIN=http://127.0.0.1:3000 npm start
```

## Coolify

Set Dockerfile path `service/Dockerfile` and build context `service/`. Expose container port 3000 and use a dedicated HTTPS domain. Set `PUBLIC_ORIGIN` to that domain's exact HTTPS origin, `MCP_ACCESS_TOKEN` to a randomly generated 64-character hexadecimal value, and the health probe to `/health/live`. Do not commit secrets.

**Not ready for public ChatGPT connection:** The temporary bearer token is only an initial internal protection, not OAuth. Do not expose the endpoint to untrusted clients or connect it publicly until DEV-008 authentication is implemented and tested. Project operations, PostgreSQL, file storage and Modal orchestration remain future steps. Readiness only means the scaffold is running.

## Security notes

Use HTTPS termination at Coolify, a non-privileged Node process and restrictive inbound access while auth is incomplete. Restrict outbound networking and reverse-proxy access as appropriate. There is no generic Python execution tool in this step.
