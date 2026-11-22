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
controller. New models start at revision 1. Existing projects can create the next revision
from any owned, checksum-verified historical `scene.blend`. Blender script
auto-execution is disabled on source loading. Each successful job publishes
immutable `scene.blend` and `scene.json`; `scene.glb` is an optional
browser preview.

### Reuse and import

- `workspace_clone_project_from_revision` creates an independent project
  from a saved native BLEND revision without running Modal.
- Modeling jobs accept `assetSources` to compose up to four verified source
  models in a scene, either from saved project revisions or private uploaded
  BLEND/GLB models; a new revision is created for the destination project.
- The signed-in browser portal provides **Importera 3D-modell** for uploading
  external BLEND/GLB files (32 MiB per file), then explicitly approving an
  owner-billed Modal import into a new or existing project. Upload alone is not
  a paid job. The asset library is limited to 50 files / 512 MiB per account.
  External OBJ imports and asset-library deletion UI are not provided.
- `workspace_list_uploaded_models` lists the owner's uploaded asset IDs for
  reuse through `workspace_queue_python_script`.

See [External BLEND/GLB import](docs/dev-041-external-blend-glb.md) and
[cross-project scene composition](docs/dev-040-scene-composition.md).

### Failure diagnostics (DEV-042)

Failed Blender modeling jobs expose owner-scoped, structured diagnostics in
`workspace_get_job` and Swedish explanations in the browser job history.
Recognized Python exceptions include the safe exception class, user-code line
and Blender exit code. Blender is started with `--python-exit-code 1` so a
Python traceback cannot masquerade as a successful command-line process.
Crash, timeout and explicitly evidenced memory exhaustion have separate
classifications; a SIGKILL alone does not prove out-of-memory. Raw Blender
logs and arbitrary traceback messages are **not** persisted or exposed to
the user, because they may contain secrets or Python source.

The Blender CI now exercises actual modern native hair curves on a sphere,
increasing strand counts through 8, 32 and 128, and a deliberately failing
Python script. Neither test uses paid Modal resources. See
[diagnostics](docs/modal-job-diagnostics.md) and
[DEV-042 acceptance](docs/dev-042-blender-error-diagnostics.md).

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

### Animated GLB playback (ANIM-001)

Saved GLB files with supported animation clips can be played directly in the
browser using Three.js. The viewer exposes clip selection, play/pause, timeline
scrubbing and repeat controls only when usable clips exist. Revisions being
compared follow the same normalized time position only when an animation with
the same name exists in both revisions; other comparisons remain static.
Playback is read-only, works without Modal jobs and does not create an MP4 or
change the authoritative `.blend` file. Blender effects that cannot be
represented as glTF animations may not animate in the browser. Browser/iPad
acceptance remains a deployment test.

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

For Coolify, use [the Docker Compose definition](deploy/coolify.compose.yaml)
and [step-by-step configuration guide](docs/dev-037-coolify-compose.md).
The stack uses an **existing shared PostgreSQL server** (no PostgreSQL
container) with a **dedicated database and role**, and accepts `PGHOST`,
`PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE` as separate
Coolify environment variables. Enter `PGPASSWORD` as a **secret** in
Coolify; no password-bearing `DATABASE_URL` is needed. A one-shot
migration job must finish before the MCP service and worker start.


GHCR images are published on stable GitHub Releases with matching version and
`latest` tags: the MCP service and an independent
Coolify Job Worker, plus a Blender image pulled by owner-funded Modal Sandboxes.
Set `BW_IMAGE_TAG=v1.2.3` or `BW_IMAGE_TAG=latest` in Coolify.
The Job Worker uses a fixed matching Blender release version.
See [GHCR and Coolify deployment](docs/dev-036-ghcr.md). PRs verify but never
publish; successful `main` publication requires GitHub Packages permissions.
The Blender GHCR package must be publicly readable before real Modal jobs.


See `service/docs/` and `.github/workflows/`. GitHub Actions compiles
Node services, validates contracts, and uses real headless Blender for
scene create/edit and artifact verification. The Python-first workflows test the MCP authoring boundary, Blender
creation/revisions, material reuse, artifact integrity and worker result markers.

Live Google/ChatGPT OAuth, user-billed Modal and browser/iPad acceptance
remain **deferred**. Do not call the service production-verified before
these tests. The authoritative historical planning state resides in
`.system-builder/work-status.yaml`.
