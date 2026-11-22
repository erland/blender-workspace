# DEV-044 – Lightweight stored complexity inspection

## Purpose
Persist useful, read-only troubleshooting metrics in the existing immutable
`scene.json`, without a separate Blender job or new MCP tools. The existing
`workspace_inspect_scene` returns `scene.objects[].complexity`.
`workspace_inspect_geometry` adds a `complexity` group containing the same
per-object snapshots, with optional stable object-ID filtering.

## Stored facts
- All objects: a bounded list (up to 64) of modifier names/types and
  `procedural` indicators. `proceduralPotential` signals known generators,
  including Geometry Nodes; it does not guarantee the modifier produces output.
- MESH: stored vertex/edge/face counts before unapplied modifiers.
- CURVES (native hair): stored curve and control-point counts.
- CURVE and POINTCLOUD: bounded spline/point counts.
- Each object reports `source: stored` and `evaluated: false`.
  `interpolatedCount: null` means generated child hair is unknown, **not zero**.

No dependency graph, evaluated mesh, render, particle interpolation or Geometry
Nodes execution is triggered for inspection. Counts are diagnostic hints,
not reliable predictions of memory or rendering cost.

## Failure and history behavior
- New successful Blender revisions save these fields into the checksum-verified
  scene report already produced by the trusted worker.
- Historical reports remain usable; missing fields are reported as unavailable
  or partial. No fabricated counts and no paid backfill.
- A Blender crash **before** `scene.json` has been saved produces no new
  complexity snapshot. DEV-042 safe failure codes remain available; it is not
  safe to claim the failed job had exactly the last successful revision's
  complexity. A bounded in-flight failure checkpoint would be a separate
  design and should not persist user Python code or raw logs.

## Verification without Modal
- The existing Service CI validates schema, legacy compatibility and hostile
  metadata through `complexity-inspection.test.mjs`.
- Blender CI makes a cube with a Geometry Nodes modifier and native hair curves,
  checks counts and serialized report, without starting Modal.
- Real deployed Google/ChatGPT/Modal and iPad acceptance remain deferred.
