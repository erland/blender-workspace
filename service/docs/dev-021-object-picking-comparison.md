# DEV-021 – Read-only object picking and GLB revision comparison

The private browser viewer can select a mesh using a pointer tap/click and
compare two saved GLB revisions side by side.

## Scope
- Raycaster picking identifies a mesh node in the current GLB scene and
  highlights it with a non-destructive bounding-box helper.
- Displays the selected node's exported GLB object name; a copy action writes
  the project UUID, revision number, and object name as a text reference for
  describing adjustments back in ChatGPT.
- The comparison selector lists owner-scoped, committed GLB revisions.
- Choosing an earlier or later revision loads a second independent read-only
  Three.js viewer; both can be rotated and zoomed separately.
- Revision 3D data is downloaded directly to the browser. No Modal run,
  Blender job or saved revision change occurs.

## Security
The new `GET /viewer/api/projects/{projectId}/revisions` requires the
existing Google settings HttpOnly session, validates project ownership,
reads only committed revisions, and returns only entries whose immutable GLB
bytes pass SHA-256 verification. Revisions are bounded to the most recent 100
committed records to limit checksum work per request. It does not return
local paths, signed URLs, cookies, or MCP credentials.

Each actual GLB request separately enforces authorization and SHA-256
verification under the DEV-019 endpoint. The viewer script is bundled locally
and stays under the existing same-origin CSP.

## Explicit limitations
- A displayed glTF node name is a *label*, not a guaranteed stable Blender
  object ID. When exported nodes are unnamed, a parent name or fallback label
  may be used. DEV-022 should introduce stable object IDs and a reliable
  object identity mapping between Blender and GLB.
- GLB export may merge/split/rename meshes. Clicking a triangle identifies
  the exported node, not necessarily the original Blender mesh data block.
- Selecting an object does not yet dispatch an edit from the browser.
- Side-by-side viewpoints are independently controlled, not synchronized.
- Browser/iPad visual acceptance and real Google login remain deferred.

CI covers page controls and the owner-scoped revision-list endpoint including
cross-origin requests, absent sessions, foreign project IDs, and corrupted
saved GLB files.
