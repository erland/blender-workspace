# DEV-020 – Link ChatGPT/MCP to the private GLB viewer

When Google OAuth is configured, Blender Workspace registers the read-only MCP
tool `workspace_get_viewer_link`. Given a `projectId` and `revision` it returns:

```json
{
  "projectId":"<UUID>",
  "revision":1,
  "viewerUrl":"https://your-service.example/viewer/<UUID>/revisions/1",
  "requiresGoogleLogin":true,
  "modalExecution":false
}
```

The existing `workspace_get_job` also includes `viewerUrl` and
`requiresGoogleLogin` when a **completed** generic scene job has a saved
GLB revision that the caller can access. Pending, failed and unsupported
legacy jobs continue to return their existing status without a viewer link.

## Security contract

All MCP requests authenticate in the usual way. A link is returned only
when the caller has `workspace:read`, owns the project, the requested
revision is committed and `scene.glb` matches its saved SHA-256 manifest.
A foreign project, uncommitted revision, missing file or corrupted artifact
results in an error; the caller does not receive a guessed URL.

Viewer links contain only a project UUID and immutable revision number;
**never** a bearer token, access grant, signed cookie or other credential.
Opening the link requires the *same user's* independent Google browser
login. A link shared with someone else grants no access. ChatGPT may show
the returned URL to the user as a normal browser link. It must not
promise an in-chat 3D view. The browser loads the GLB locally with Three.js
and causes no Blender/Modal execution.

The viewer-link tool is advertised only when the service has a Google
browser login/viewer configured; internal-token-only services do not
advertise dead viewer links. `PUBLIC_ORIGIN` is validated at startup
and is the sole base for URL construction.

## Scope

DEV-020 deliberately does not implement object selection, anonymous sharing,
or a new image rendering pipeline. Those require separate scope and testing.

CI covers the HTTP MCP tool list, success, missing revisions, foreign
projects, tampered GLB data and completed/pending job behavior.
Real Google login, ChatGPT plugin UX, real browser GPU execution and
personal Modal billing still require live acceptance.
