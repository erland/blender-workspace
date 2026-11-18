# Blender Workspace MCP service

Blender Workspace uses PostgreSQL for user-owned projects, encrypted personal Modal credentials, immutable revisions, Google/OAuth authentication and a separate Modal dispatcher.

Implemented steps:
- [Google login – DEV-008](docs/dev-008-google.md): automated tests passed, live acceptance deferred
- [Personal Modal credentials – DEV-009](docs/dev-009-modal-accounts.md): encrypted per-owner tokens; real Modal billing tests deferred
- [Automatic worker – DEV-010](docs/dev-010-dispatcher.md): PostgreSQL-backed dispatcher; external test deferred
- [Reopen and revise scenes – DEV-011](docs/dev-011-scene-revision.md): project version 1 ➝ 2, safe predefined blue recolor; source hash verified; new immutable revision

The initial demo scene retains its armature and animation. **Only the predefined blue recolor is currently implemented**, not arbitrary 3D editing through ChatGPT.

From `service/`: `npm install && npm run check`. Run `npm run db:migrate` before starting HTTP or worker processes. Build worker with `job-worker/Dockerfile` (repository-root build context). No live Google or personal Modal operation was executed in DEV-011 CI.

## DEV-013 – Editable monster parts

The strict structured edit contract now permits the generated meshes `Body`, `LeftLeg`, `RightLeg`, `LeftEye`, `RightEye`, `LeftPupil`, and `RightPupil`. The read-only `workspace_list_editable_parts` MCP tool lists these names and supported properties. The Blender worker still takes validated data-only JSON, never executable user scripts. Each request edits one target and creates an immutable revision; it cannot edit rig/animation, add meshes, or perform general-purpose modeling. Live Modal/Google acceptance remains deferred.
