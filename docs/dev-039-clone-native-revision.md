# DEV-039 — New independent project from a saved BLEND revision

## Behavior
The `workspace_clone_project_from_revision` MCP tool (write scope required)
creates an independent new project using the exact verified source revision
from a project owned by the authenticated identity. Unlike DEV-038's
within-project historical revision branching, the destination starts at
revision 1 and is editable independently.

Example input:
```json
{"sourceProjectId":"OWNED_PROJECT_UUID","sourceRevision":12,
 "name":"Alternative T-Rex","description":"Variant based on revision 12"}
```
A successful reply returns the new project, `newRevision: 1`, and the source
reference. No Modal account or paid Blender job is required.

## Isolation and integrity
- The source project and revision are owner-verified; the source must have a
  saved `scene.blend`, not only a disposable GLB preview.
- All files in the original source's immutable revision manifest are SHA-256
  verified before a destination project is created and reverified on copying.
- The target is staged hidden, its revision 1 artifacts are written under a
  new project UUID, and PostgreSQL makes it visible only after copy success.
- The original project remains untouched. Copied bytes and revision history
  are independent, even when the source is later deleted.
- `bw_project_revisions.source_project_id` and
  `source_project_revision` record provenance for cloned revisions. No FK
  ties the destination lifetime to the original source.
- No scripts are executed, no Modal resources are allocated, and scripts,
  historical execution jobs, OAuth credentials or rendered preview jobs are
  not imported. The new project can be modified using the ordinary Python
  modeling tool starting at expectedRevision 1.
- Errors during copying remove uncommitted staging files/metadata. As with
  existing ZIP import, uncertain commits are not destroyed.

## Out of scope
Cross-project assembly, external BLEND/GLB uploads and asset-library
management remain DEV-040/041. OBJ is excluded by user request. Live browser
and Modal integration are not established by CI alone.

## Verification
Database integration tests cover owner isolation, exact artifact hashes,
historical source selection, new revision numbering, independent later edits,
preserved provenance after source deletion, corrupt data rejection, and
failure rollback.
