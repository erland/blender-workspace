# DEV-038 — Create the next model revision from an earlier saved revision

## Decision and behavior
- A Blender Workspace project retains one monotonically increasing immutable
  revision sequence. No history is rewritten, deleted or renumbered.
- The existing `workspace_queue_python_script` modeling tool takes an optional
  integer `sourceRevision`. Without it, behavior is unchanged and the latest
  revision is used as the source.
- `expectedRevision` must **always** match the project's current latest revision.
  The new revision is always `expectedRevision + 1`. `sourceRevision` must be
  a saved, checksum-verified revision between 1 and `expectedRevision`.
  The selected source is read-only and may be a much earlier revision.
- A valid script such as `pass` copies the chosen revision unchanged into the
  next revision (BLEND + GLB derived preview + scene report); an arbitrary
  `bpy` script may edit it before publishing.
- The authoritative `scene.blend` source is verified **again** by the job
  worker before starting the billable Modal Sandbox.
- `bw_jobs.source_revision` and `bw_project_revisions.source_revision` record
  the actual source of new jobs; existing historical rows retain NULL (unknown).
  The read-only revisions tool includes `sourceRevision` when recorded.

## Example
Project has latest revision 26. This call creates revision 27 from revision 10,
retaining revisions 11–26:

```json
{
  "projectId": "EXISTING_PROJECT_UUID",
  "expectedRevision": 26,
  "sourceRevision": 10,
  "code": "pass",
  "note": "Alternative starting from revision 10"
}
```

## Limitations and next increments
- The source must be within the **same project**; project cloning, cross-project
  scene composition and external BLEND/GLB upload are subsequent steps.
- Scene composition with multiple meshes, cameras, rigged models and
  collections already works via Blender Python in one project.
- A new revision from history is not a Git-style branch and does not maintain
  an independently moving branch head.
- No OBJ import is planned under this change request.

## Verification
PostgreSQL tests must establish immutable old artifacts, source selection,
lineage, next-revision numbering, owner isolation, duplicate job prevention,
and rejection of stale/future/invalid source revisions. Existing Blender
revision tests and production image builds must pass. No paid Modal job is
executed by CI.
