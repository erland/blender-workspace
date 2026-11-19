# Blender Workspace

A multi-user, model-independent Blender workspace operated through an
authenticated MCP service. Project/job/revision metadata lives in PostgreSQL;
artifacts are stored with SHA-256 integrity metadata. User-owned Modal
credentials power short-lived, network-blocked Blender Sandboxes.

## Authoring: Python-first

**The only public MCP modeling-write tool is
`workspace_queue_python_script`.** Supply an owned project ID, the expected
current revision and a bounded Blender Python script. The script runs inside
Blender with `bpy`, not inside the MCP server or the credentialed Modal
controller. New models start at revision 1; edits open only the checksum-
verified previous `scene.blend`, with script auto-execution disabled.
Each successful job creates a new immutable `scene.blend`, `scene.glb`
and `scene.json`.

### Preflight before paid Blender execution (DEV-035)

The MCP service deployed through Coolify includes a minimal CPython interpreter,
**not Blender**. Before saving a new Python job, it validates its UTF-8/size
limits and compiles its source with `compile(..., "exec")` inside a bounded,
non-executing `python3 -I` subprocess. Syntax and indentation mistakes return
a line/column diagnostic to the MCP caller, with **no queued job and no Modal
Sandbox charge**. The repository performs the same check before its database
transaction to prevent bypass by internal callers. If Python is unavailable
or times out, queueing fails closed.

This syntax-only check does **not** execute or import `bpy`, prove a Blender
API call exists, guarantee objects exist, or replace isolated execution and
artifact checks in Modal. It uses the service's installed CPython version,
which may differ from Blender's embedded version.

The previous typed geometry/material/scene-edit and monster-demo MCP write
tools have been **removed from the public interface**. This project has
not been used through MCP, so there is no backward-compatible MCP authoring
contract to retain. The retired typed scene authoring and monster demonstration workers have
been removed from the production code and test entrypoints.

### Typed control and inspection

- Project create/list/get/rename, job status and revision history.
- `workspace_inspect_scene`: object names, UUIDs, transforms and scene metadata.
- `workspace_inspect_geometry`: mesh statistics, dimensions, bounds,
  UV counts, modifiers and simple topology diagnostics from saved JSON.
- `workspace_validate_model`: non-manifold, open-boundary, loose and
  degenerate geometry **warnings** (not a guarantee of 3D print readiness).
- `workspace_list_materials`: material catalog saved with a revision.
- `workspace_get_viewer_link`: owner-checked, token-free URL that requires
  the user's Google browser session.

Read-only inspection uses verified saved reports, with no additional
Blender/Modal job. Historical revisions lacking geometry/material metadata
report unavailable information rather than fabricated values.

## Web GLB viewer

An authorized user can inspect saved GLB revisions interactively,
select named mesh nodes with stable object IDs, compare revisions, use
six camera presets (including top/isometric), display bounding boxes,
axes or wireframe, and download a PNG from the browser. Browser-only
viewer operations use Three.js/WebGL and **do not start Modal rendering**.

## Security and limitations

- Python is **untrusted executable content**. It runs in a short-lived
  Modal Sandbox with blocked network egress and no Modal account tokens,
  secrets or other projects' assets. The controller performs structural,
  checksum and size verification of returned files before publication.
- Source must be UTF-8, nonempty and at most 16,384 bytes. The isolated
  worker currently bounds object and mesh counts and topology size, with
  a configurable time/memory/CPU limit. These are safeguards, not proof
  that all Blender files or arbitrary scripts are harmless.
- Python scripts should not include credentials or sensitive data.
- GLB display and file structures are not equivalent to a full security
  audit or a guarantee of professional visual quality.
- Local scripts can create complex geometry but external texture/image
  downloads are disabled by the sandbox network policy. Cross-project
  assets and large file uploads require a separate owner-bound protocol.

## Deployment and verification

See `service/docs/` and `.github/workflows/`. GitHub Actions compiles
Node services, validates contracts, and uses real headless Blender for
scene create/edit and artifact verification. The Python-first workflows test the MCP authoring boundary, Blender
creation/revisions, material reuse, artifact integrity and worker result markers.

Live Google/ChatGPT OAuth, user-billed Modal and browser/iPad acceptance
remain **deferred**. Do not call the service production-verified before
these tests. The authoritative historical planning state resides in
`.system-builder/work-status.yaml`.
