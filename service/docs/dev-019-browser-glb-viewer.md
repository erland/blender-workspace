# DEV-019 – Browser GLB viewer without Modal

The Google-authenticated user can open an owned saved scene in a same-origin
Three.js browser viewer:

```
/viewer/{projectId}/revisions/{revision}
```

Viewer capabilities: orbit, pan, zoom, automatic camera framing, reset camera,
and save the current WebGL view as a PNG on the local device. Three.js,
OrbitControls and GLTFLoader are bundled into the server image at build time;
no third-party JavaScript CDN is required. The browser reads the saved GLB
directly: **viewing does not run Blender or Modal**.

## Identity and access

The viewer uses the existing **Google settings login session**, a signed,
HttpOnly, Secure, SameSite=Lax cookie. DEV-019 extends its cookie path from
`/settings` to `/` so that the signed session also authorizes the viewer.
Existing settings login/logout and expiry rules remain authoritative.

The HTML is delivered only if the cookie identifies the owner of the project
and revision. The browser then fetches:

```
GET /viewer/api/projects/{projectId}/revisions/{revision}/scene.glb
```

This endpoint independently rechecks the signed session and ownership,
checks a committed immutable revision and checks the saved GLB against the
artifact SHA-256 manifest. There is **no bearer token or session secret**
in the link, in JavaScript, or in localStorage.

The public URL contains only a project UUID and revision number; it is not a
shareable public model URL. The receiving browser still needs the owner's
session. Cache-Control disables caching of private responses. A strict
same-origin CSP protects the page and external origins cannot fetch GLB data.

## Scope and limitations

A user needs to log into the Google settings page before opening the viewer.
This step does not include a ChatGPT-generated viewer link or in-chat rendering;
that is planned for DEV-020. The viewer is read-only: mouse/touch orbiting,
zooming and local screenshots do not change saved model revisions.
For very large GLB files, rendering is limited by the user's GPU and memory.

CI includes a bundled production build and regression tests for session
access, owner isolation, missing/tampered models, cross-origin requests, and
HTML without credential exposure. Live Google, real browser GPU/device
acceptance, ChatGPT OAuth and individual Modal billing remain deferred.
