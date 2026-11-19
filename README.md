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
- Build bounded custom polygon meshes from vertices and face indices.
- Change mesh location, scale, rotation or material color.
- Duplicate an existing mesh with a new name and optional transforms.
- Rename objects without rebuilding their geometry.
- Delete named objects.

The first operation in a new scene must add a primitive. A batch produces
one immutable revision (`scene.blend`, `scene.glb`, `scene.json`).
Existing scenes can be inspected through `workspace_inspect_scene`.
DEV-030 adds read-only `workspace_inspect_geometry` and `workspace_validate_model`
for saved scene reports with typed mesh counts, world bounds and diagnostic
mesh-quality findings. These tools never run Modal, and older reports without
metrics explicitly report unavailable data rather than guessed measurements.
See [DEV-030 geometry inspection](service/docs/dev-030-geometry-inspection.md).
A Google-authenticated user can view saved GLB revisions in the browser;
`workspace_get_viewer_link` returns an owner-checked link from MCP, and
`workspace_get_job` includes the link for completed GLB jobs.
The read-only browser viewer can select named GLB mesh nodes and compare
saved revisions side by side without running Blender or Modal.
DEV-031 adds six camera presets (including isometric/top), bounding-box and
coordinate-axis helpers, wireframe inspection and browser-local PNG export.
These functions do not start Modal jobs or incur server rendering costs.
See [DEV-031 browser inspection](service/docs/dev-031-browser-glb-inspection.md).
See [DEV-021 selection and comparison](service/docs/dev-021-object-picking-comparison.md).
From DEV-022, generic Blender scene objects carry persistent UUIDs in the BLEND,
scene report and GLB node extras; new duplicates get independent IDs, and old
revisions remain readable. See [DEV-022 identity contract](service/docs/dev-022-stable-object-identities.md).
Existing object operations can now target a stable UUID rather than a mutable name;
`set_parent` links/unlinks children without changing their world position.
See [DEV-023 hierarchy contract](service/docs/dev-023-uuid-parenting.md).
See [DEV-020 viewer links](service/docs/dev-020-mcp-viewer-links.md).
The earlier cube-monster example remains a regression/demo case, **not**
a restriction on what scenes the service can represent.

The structured scene operation tool remains bounded and never accepts executable
Python. DEV-029 introduces a separate, owner-scoped `workspace_queue_python_script`
that executes AI-authored Blender Python only inside a short-lived, network-blocked
Modal Sandbox. It uses the same immutable revision pipeline, with structural and
checksum checks of returned BLEND/GLB/JSON artifacts. This is an initial, limited
integration and **not yet live-accepted or production security-certified**.
See [DEV-029 sandboxed Python contract](service/docs/dev-029-sandboxed-python.md). See
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

Custom mesh geometry (`add_mesh`) is bounded and validates indices, finite coordinates
and polygon size. See [DEV-024 custom mesh](service/docs/dev-024-custom-mesh.md).

DEV-025 adds bounded, applied mesh bevel, subdivision and Boolean edits,
addressed by stable object UUID or name. See [mesh modifiers](service/docs/dev-025-mesh-modifiers.md).

DEV-026 supports safe face extrusion, single-axis mirroring and bounded mesh arrays
in versioned Blender operations. See [DEV-026 geometry operations](service/docs/dev-026-extrude-mirror-array.md).

DEV-027 supports safe, GLB-compatible Principled BSDF materials with metallic,
roughness, opacity and emission. See [PBR material contract](service/docs/dev-027-pbr-materials.md).

DEV-028 provides initial bounded import of small, self-contained GLB assets via a
validated MCP operation, with fresh stable IDs and continued versioned edits.
Large-file upload and real-world acceptance remain separate requirements.
See [DEV-028 GLB import](service/docs/dev-028-bounded-glb-import.md).
