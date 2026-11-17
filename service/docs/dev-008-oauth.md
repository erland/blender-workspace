# DEV-008 – OAuth 2.1 resource server

The MCP endpoint can now run in OAuth resource-server mode, validating signed JWT access tokens from a separately deployed OAuth/OIDC identity provider. **This project does not implement its own authorization server.** Use an established provider that supports authorization code with PKCE S256, discovery metadata, ChatGPT client identification (CIMD/DCR/predefined client), and resource/audience binding.

## Config (Coolify)

- `MCP_AUTH_MODE=oauth`
- `PUBLIC_ORIGIN=https://blender.example.org` – canonical public HTTPS origin; tokens must have `aud` equal to this value
- `OAUTH_ISSUER=https://identity.example.org/realms/blender` – exact issuer from token/discovery
- `OAUTH_JWKS_URI=https://identity.example.org/realms/blender/protocol/openid-connect/certs` – trusted HTTPS signing key endpoint
- `DATABASE_URL` – dedicated PostgreSQL user/database

Set these as appropriate protected environment variables. **Do not set `MCP_OWNER_KEY` in OAuth mode**; ownership is derived server-side from the validated issuer and subject. Neither shared `MCP_ACCESS_TOKEN` nor unverified `sub` claims are accepted in OAuth mode. Applications should use HTTPS termination on Coolify and only route the intended hostname to the service.

## Protocol and security

`GET /.well-known/oauth-protected-resource` advertises the MCP resource identifier, issuer and supported scopes `workspace:read` and `workspace:write`. Unauthenticated calls return `401` with a `WWW-Authenticate: Bearer resource_metadata=...` challenge.

Every `/mcp` request verifies JWT signature against provider JWKS, issuer, audience, expiration and scope. Only asymmetrically signed RS256/ES256 tokens are accepted. Owner key is a stable SHA-256 digest of issuer plus authenticated subject, never a user-supplied tool argument. Read and write tools require their respective scope; error responses expose no database details.

Before public deployment, verify the external identity provider's `.well-known/oauth-authorization-server` or OIDC discovery includes `code_challenge_methods_supported: ['S256']`, token endpoint authentication methods, client registration mechanism and correct `authorization_endpoint` / `token_endpoint`. Configure `resource` parameter propagation into the JWT `aud` claim. Use the ChatGPT plugin configuration page's exact redirect URI when registering its OAuth client; do not guess. Consider `offline_access` if you need refresh tokens.

## Test and limitations

GitHub Actions tests validate real signed RSA JWTs and real PostgreSQL-backed MCP calls, including denial of invalid issuer/audience, expired tokens, insufficient scopes and cross-user project isolation. The tests do not prove that a specific external OAuth provider, Coolify deployment, ChatGPT callback, consent screen or token renewal is configured correctly.

This release retains `MCP_AUTH_MODE=internal` for the earlier single-owner development deployment. Do not publish internal mode as an Internet-facing ChatGPT plugin.

**Live ChatGPT OAuth connection and issuer discovery remain required acceptance gates** before declaring the external integration production-ready.
