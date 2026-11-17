# DEV-008 – Google Login, according to Agent Workspace pattern

This adds a **built-in OAuth 2.1 authorization server** to Blender Workspace, based on the existing Agent Workspace design (Google OIDC upstream + locally issued resource-bound MCP tokens). Blender Workspace now offers three explicitly selected modes:

- `MCP_AUTH_MODE=internal` – developer-only shared Bearer secret, never public
- `MCP_AUTH_MODE=oauth` – external OIDC/OAuth JWT issuer (existing DEV-008)
- `MCP_AUTH_MODE=google` – **own OAuth server** with Google as upstream identity provider

It does **not** reuse Google access/ID tokens as MCP bearer credentials. Our own Ed25519 JWTs carry `aud=PUBLIC_ORIGIN` and per-user `sub=Google subject` and are verified by the existing MCP resource server. Google access tokens are never persisted.

## Google Cloud configuration

Register a Google OAuth Web application with authorized callback:

`https://<your-mcp-host>/auth/google/callback`

Use Coolify HTTPS termination and set these as **secrets** (replace examples):

```env
MCP_AUTH_MODE=google
PUBLIC_ORIGIN=https://blender.example.org
DATABASE_URL=postgres://separate-user:secret@postgres-host:5432/blender_workspace
GOOGLE_CLIENT_ID=<google-web-client-id>
GOOGLE_CLIENT_SECRET=<google-web-client-secret>
OAUTH_SIGNING_KEY=<base64-Ed25519-PKCS8-DER>
OAUTH_SESSION_SECRET=<random-secret-at-least-32-characters>
GOOGLE_ALLOWED_REDIRECT_ORIGINS=https://chatgpt.com,https://auth.openai.com
GOOGLE_ALLOWED_EMAILS=user@example.com
```

The redirect-origin allowlist is **mandatory**, to reduce arbitrary dynamic OAuth client registration. Set it to the **actual trusted redirect origin(s)** observed in your ChatGPT plugin registration; these example origins are not verified callbacks. The exact redirect URIs themselves are registered per client and matched exactly at authorization. Google callback is always on the Blender Workspace HTTPS host. `GOOGLE_ALLOWED_EMAILS` is optional; restrict pilot access to trusted email addresses and keep it configured until an appropriate user-approval policy is deployed.

Generate signing and cookie secrets:

```sh
openssl genpkey -algorithm ED25519 -outform DER | openssl base64 -A
openssl rand -base64 48
```

Never put secrets into GitHub or public source. Store the signing key durably: changing it invalidates existing access JWTs, and all active refresh tokens should be revoked when rotating it. Use a dedicated database/app role and execute `npm run db:migrate` before switching on Google mode.

## OAuth endpoints

- `GET /.well-known/oauth-authorization-server` – issuer metadata
- `GET /.well-known/oauth-protected-resource` – MCP metadata
- `POST /register` – dynamic public client registration (restricted to configured redirect origins; bounded registration rate)
- `GET /authorize` – OAuth code + mandatory PKCE S256 and exact `resource` parameter
- `GET /auth/google/callback` – Google ID-token signature, audience, issuer, nonce and verified-email checks
- `POST /token` – code exchange and single-use refresh-token rotation
- `GET /jwks` – public Ed25519 signing key

Code and refresh tokens are stored **hashed** in PostgreSQL and consumed atomically. OAuth login state is HMAC-signed in an HttpOnly Secure SameSite=Lax cookie. OAuth scopes are `workspace:read` and `workspace:write`; user ownership is derived from the validated token subject/issuer. The server does not store raw Google tokens.

## Verification and remaining acceptance

CI runs end-to-end OAuth client registration, PKCE, simulated Google sign-in, own token issuance, refresh/replay rejection, per-user project isolation and MCP access through real HTTP/PostgreSQL. **The simulated Google provider in tests is not evidence that real Google login, ChatGPT redirect, or Coolify HTTPS hosting works.**

Acceptance still requires a live Google Cloud OAuth client, deployment, real browser sign-in, scope/consent experience, and actual ChatGPT connector test. Do not mark DEV-008 completed or expose it publicly until these tests and an authentication/security review are done. More robust consent, abuse prevention and key rotation remain production hardening work.

Reference implementation inspected: [Agent Workspace OAuth server](https://github.com/erland/agent-workspace/blob/main/src/auth/agent-oauth-server.ts) and [Coolify guide](https://github.com/erland/agent-workspace/blob/main/docs/coolify-deployment.md). This is an adapted, independent implementation, not a shared library.
