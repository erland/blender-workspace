# DEV-018 – Authenticated, immutable GLB retrieval

A saved generic Blender revision can be retrieved using:

```http
GET /api/projects/{projectId}/revisions/{revision}/scene.glb
Authorization: Bearer <existing workspace access token>
```

Returns `200` with `Content-Type: model/gltf-binary` only when all checks pass:
- A valid service bearer credential (internal mode or verified OAuth access token).
- The `workspace:read` scope in OAuth mode.
- The project belongs to the authenticated owner.
- The requested revision exists, is committed and has its expected artifact prefix.
- `scene.glb` exists in the immutable revision manifest and its saved bytes match SHA-256.

The route does **not** accept arbitrary artifact paths or filenames. It returns
generic `404 not_found` for missing/foreign revisions and failed integrity
verification without revealing cross-tenant existence. It disables caching and
sets `nosniff` plus a same-origin resource policy.

This step does not run Blender or Modal; it streams already published GLB files.
It does not generate screenshots, expose public download links, or support
bearer tokens in query strings.

**Browser viewer integration is deliberately a separate step.** A user's
ChatGPT MCP token must not be embedded in a link to the viewer, localStorage,
or browser query parameters. DEV-019 must determine how a Google-authenticated
browser session can fetch an owned GLB or receive a short-lived, scoped
download grant without exposing tokens.

Local tests in `glb-access.test.mjs` cover authorized delivery, unauthorized
requests, cross-user isolation, bad revisions and tampered files. Live Google
login and individual Modal billing remain deferred.
