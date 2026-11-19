# DEV-029 — sandboxed Blender Python (first integration)

This is a **bounded first integration**, not a complete security certification.

## What changes

- A separate MCP tool `workspace_queue_python_script`, requiring write scope,
  a real owner-scoped project, a connected personal Modal account,
  expected revision and validated Python source (1–16,384 characters).
- Source is stored as `{kind:"python_script",code:"..."}` in the existing
  job queue. Normal `workspace_queue_scene_operation` continues to reject
  executable content. Every Python job must be explicitly queued.
- The existing dispatcher and `JobOrchestrator` continue to claim jobs
  atomically and use immutable, owner-scoped revisions. Python uses the
  `runPythonScript` branch of the executor; a previous revision is read
  only after SHA verification.
- The trusted Modal **controller** retrieves the owner's credentials.
  It creates a fresh short-lived Modal Sandbox using the existing Docker
  Blender image with `block_network=True`, **no secrets and no volume mounts**.
  Only the script and, for edits, the verified source BLEND are transferred.
  No AI Python runs inside Node or the credentialed Modal controller.
- The sandbox wrapper loads the scene (script auto-execution disabled),
  runs Python with Blender's `bpy` API, enforces 512 objects/256 meshes/
  200k vertices/100k polygons, assigns/fixes stable UUIDs and creates
  `scene.blend`, `scene.glb`, `scene.json`.
- After download, the trusted controller validates each file's size,
  BLEND and GLB headers, GLB JSON envelope, local-only asset references,
  scene report identity uniqueness and declared checksums. It then returns
  the files to the existing immutable artifact publisher for additional
  checksum, size and revision checks. Failed jobs publish no revision.

## API example

`workspace_queue_python_script`:

```json
{
  "projectId": "EXISTING_PROJECT_UUID",
  "expectedRevision": 0,
  "code": "import bpy\nbpy.ops.mesh.primitive_cube_add()",
  "note": "Create initial scene with bpy"
}
```

Edit an existing model by setting `expectedRevision` to the latest
revision and changing objects in `bpy.data.objects`. No custom Docker
paths, URL fetches, extra libraries or external assets are supported.

## Important security caveats

- Python is **unrestricted inside the isolated Sandbox**. No static-code
  inspection makes it safe. It can read files inside its own ephemeral
  environment, spawn subprocesses, and delete its own working data.
  Network egress is blocked by Modal and no controller credentials or
  other users' files are passed into it.
- A structurally valid BLEND/GLB file is not proof that it is harmless or
  semantically correct. **Never execute, render or open user-produced BLEND
  outside an isolated worker**; structural validation cannot detect all
  parser attacks or embedded driver/handler expressions.
- Python source is persisted as job data. Users should never place
  credentials, personal information or sensitive business data into it.
- The execution limit is 900 seconds with bounded CPU/RAM in the existing
  Modal runner. There is no hard monetary spend cap yet: production use
  requires per-account budgets, metering, rate limits and detailed
  failure-mode tests. Native Modal provisioning must still be tested live.
- The source `scene.blend` and produced `scene.blend` are loaded/saved
  only inside the Sandbox. Future trusted workers must also disable
  untrusted script auto-execution when opening such files.
- This step does **not** enable free-form Python through the existing
  structured scene-operations API, and no existing jobs are migrated.

## Automated verification

`.github/workflows/sandbox-python-dev029.yml` runs Python output-validation
unit tests and real headless Blender:
  1. Executes user-style Python creating a cube and sphere in a new scene.
  2. Reopens that BLEND revision inside the worker, moves the cube and adds
     a cylinder with separate Python.
  3. Checks GLB/BLEND/JSON integrity and that UUIDs of existing objects
     survived the revision.

Node tests verify schema segregation and DB-backed job authorization,
revision numbering, atomic publication and failure state. The Modal SDK
is mocked in unit tests: no personal account billed by CI.
A real-user authentication, Modal billing and end-to-end MCP run remain
**deferred**.
