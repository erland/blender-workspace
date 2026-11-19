# DEV-033 — Python-first modeling and trusted inspection

## Decision

An untested MCP interface does not require backwards-compatible authoring.
Blender Workspace therefore exposes **one** modeling-write MCP tool:
`workspace_queue_python_script`. The previous user-facing typed
scene-operation, structured scene-edit and two hardcoded monster/demo
write tools are removed from `registerProjectTools`.

Typed MCP tools **remain** for project management, job/revision history,
verified scene and geometry inspection, diagnostic validation, saved material
catalogues and links to the browser GLB viewer. The same SHA-256 protected
immutable revisions, ownership checks and personal Modal-account
requirements continue to apply.

The previous internal scene-operation modules and regression fixtures are
not part of the supported MCP API and remain in this step solely to keep
older integration tests available while stabilizing Python execution.
They are not a compatibility requirement; dead implementation can be
removed after the Python path has cleared offline and live gates.

## Python execution contract

1. A user with write scope selects an owned project, specifies its exact
   expected revision and submits 1–16,384 UTF-8 bytes of Blender-Python.
   Null bytes, oversize payloads and extra schema fields are rejected.
2. The queue validates ownership and optimistic concurrency, and for edits
   verifies the predecessor `scene.blend` hash before scheduling.
3. The credentialed controller starts an ephemeral Modal Sandbox with
   `block_network=True` and no passed Modal credentials/secrets; it copies
   only the script and, for edit jobs, the predecessor BLEND into the worker.
4. Blender opens the source (without auto-running embedded scripts),
   executes submitted Python using `bpy`, checks bounded scene counts,
   and saves BLEND, GLB and JSON.
5. The controller now requires the explicit
   `BW_SANDBOX_PYTHON PASS` marker for **all Python revisions**, not
   the legacy demo's `BW_SMOKE PASS`. Missing markers fail before
   artifact download; the Sandbox is terminated in a `finally` block.
6. The controller validates transferred artifact structures, checksums
   and bounded metadata. Existing immutable artifact publication and
   PostgreSQL revision commit remain independent; recovery never reruns
   a potentially billed job automatically.

## Offline verification

The new `.github/workflows/python-first-dev033.yml` runs:

- Python mocked Modal lifecycle tests, including creation/edit missing-marker
  failures, cleanup and output rejection before publication;
- Node MCP tool-surface assertions: the Python writer is the **only** queue
  authoring tool; read-only inspection and material tools remain registered;
- owner and revision checks: stale revisions and foreign projects do not
  queue Python; edits verify the predecessor;
- Python source input schema regressions, including UTF-8 byte length.

Existing headless Blender Python creation/edit and UUID tests remain in
`.github/workflows/sandbox-python-dev029.yml`.

## Deferred acceptance

Real connected Google/ChatGPT OAuth, user-billed Modal and browser/iPad
acceptance are intentionally deferred. These offline checks do not prove
production isolation, security of all generated BLEND files or visual quality.
