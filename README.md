# Blender Workspace

A multi-user, model-independent, headless Blender workspace controlled by
an authenticated MCP service. Project/job/revision metadata lives in
PostgreSQL; scene artifacts are stored with SHA-256 integrity metadata.
A background dispatcher can run short-lived, owner-scoped Blender jobs
through Modal.

## Current modeling capabilities

The MCP tool `workspace_queue_scene_operation` queues one validated scene
operation or a batch of 1–20 ordered operations. Supported operations:

- Add named cubes, UV spheres, cylinders, cones or tori.
- Change mesh location, scale, rotation or material color.
- Duplicate an existing mesh with a new name and optional transforms.
- Rename objects without rebuilding their geometry.
- Delete named objects.

The first operation in a new scene must add a primitive. A batch produces
one immutable revision (`scene.blend`, `scene.glb`, `scene.json`).
Existing scenes can be inspected through `workspace_inspect_scene`.
A Google-authenticated user can view saved GLB revisions in the browser;
`workspace_get_viewer_link` returns an owner-checked link from MCP, and
`workspace_get_job` includes the link for completed GLB jobs.
See [DEV-020 viewer links](service/docs/dev-020-mcp-viewer-links.md).
The earlier cube-monster example remains a regression/demo case, **not**
a restriction on what scenes the service can represent.

This is bounded procedural scene authoring, not arbitrary AI-to-mesh
generation or unrestricted Python script execution. See
[DEV-015 batch contract](service/docs/dev-015-batched-operations.md)
[DEV-016 duplication contract](service/docs/dev-016-duplicate-objects.md),
and [DEV-017 rename contract](service/docs/dev-017-rename-objects.md).

## Deployment and security

See the documentation in `service/docs/` for Google OAuth, MCP,
PostgreSQL, Coolify, personal Modal credentials and job dispatch.
The service enforces owner authorization and optimistic scene revision
checks. Do not expose legacy internal bearer-token mode publicly.

The code and mocked integrations have CI coverage, but **live Google/
ChatGPT OAuth login and individually billed Modal execution remain
deferred acceptance gates**. Do not describe the service as production
verified until these pass.

## Local demo and CI

Run the legacy Blender example with Docker:

```bash
./scripts/run_docker.sh
```

GitHub Actions runs the Python and Node/PostgreSQL/MCP tests, builds
service/worker containers and executes real headless Blender
create/reopen/edit flows. See `.github/workflows/`.
The authoritative development state is
`.system-builder/work-status.yaml`.
