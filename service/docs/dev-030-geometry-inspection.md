# DEV-030 — saved geometry inspection and model diagnostics

## Goal and boundaries

Add two typed, owner-scoped **read-only** MCP tools for understanding
saved Blender revisions. They read SHA-256-verified `scene.json` reports,
not `.blend` files. They **do not** launch Modal, run Python, create jobs,
consume additional Blender compute or modify revisions.

All new Blender-generated scene reports (structured operations,
Sandbox Python, and the legacy demos) now capture base-mesh metrics:

- Stable object UUID, name and type (existing)
- Base mesh vertices, edges, faces and triangulated polygon estimate
- World-space axis-aligned bounding box (min, max, dimensions in Blender units)
- Number of UV layers and the first 64 modifier names/types
- Diagnostic counts for open boundary edges, non-manifold edges (>2 faces),
  loose edges (no incident face), isolated vertices and degenerate faces
- A bounded list of warning codes and counts

These metrics describe the **mesh datablock** before non-applied modifiers;
world bounds are based on the object's local bounding box transformed with
its world matrix. They do not evaluate modifiers, shape keys, Geometry Nodes,
animated deformations, rigging or material rendering. Triangulation is a
polygon-corner estimate, not guaranteed tessellated render topology.

## New tools

`workspace_inspect_geometry({projectId, revision, objectId?})`

Returns `available`, `partial`, `reason`, `meshCount`,
`meshesWithoutMetrics` and object-specific geometry data (UUID, name,
counts, bounds, UV layers, modifiers, quality checks and warning codes).
`objectId` is optional and filters to the saved stable UUID.

`workspace_validate_model({projectId, revision, objectId?})`

Returns `status` = `no_warnings`, `warnings` or `incomplete`,
with counted findings. `no_warnings` means **none of the implemented
checks detected a problem**, not that the mesh is watertight, 3D-printable,
safe to execute, good-looking or ready to export.

Both tools enforce the same OAuth read scope and project ownership as
`workspace_inspect_scene`; each revision must be present in the owner's
saved history and have a verified manifest and JSON checksum.

## Historical compatibility

Reports produced before DEV-030 have no `geometry` key. These immutable
revisions remain readable. The new tools report `available:false` and
`status:incomplete` for missing geometry data, **never** inferred
measurements. Mixed or partially populated reports indicate `partial:true`.
Generating metrics for historical revisions would require an explicit,
future re-inspection workflow executed in an isolated worker.

## Tests without live Modal acceptance

- `service/__tests__/geometry-inspection.test.mjs` verifies typed
  parsing, proper counts, diagnostic findings, old revisions and rejection
  of inconsistent/malicious metadata.
- `tests/geometry_inspection_smoke.py` creates a watertight cube and
  an open plane in real headless Blender, checks their counts and world
  bounds, and checks metrics in the written scene report.
- `.github/workflows/geometry-inspection-dev030.yml` builds the same
  Blender Dockerfile and runs both suites completely offline.

Live ChatGPT OAuth and personal Modal execution are **not** part of DEV-030,
as requested; their previous acceptance gate remains deferred.
