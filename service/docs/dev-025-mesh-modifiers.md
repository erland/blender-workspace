# DEV-025 – Bounded Blender mesh modifiers

Three new typed operations can edit any existing mesh by `name` or stable
`objectId` (exactly one). Each is executed in the normal revision-producing
Blender job and produces fresh immutable BLEND, GLB and JSON artifacts.

```json
{"kind":"bevel_mesh","objectId":"<uuid>","width":0.18,"segments":2}
```

```json
{"kind":"subdivide_mesh","objectId":"<uuid>","levels":1}
```

```json
{"kind":"boolean_mesh","objectId":"<target-uuid>",
 "operandId":"<other-mesh-uuid>","operation":"difference"}
```

Boolean operations support `union`, `difference`, `intersection`. The
operand is an existing, different mesh in the same saved scene, identified
only by its UUID. It is **not** implicitly deleted; the caller can delete
the operand in the same bounded batch after the Boolean has been applied,
if desired.

## Bounds and semantics

- Bevel width 0.001–2.0, 1–3 segments, angle-limited edges.
- Catmull–Clark subdivision levels 1–2.
- Boolean solver EXACT, with one of three enumerated operations.
- Inputs must be mesh objects with at most 20,000 vertices and 40,000
  polygons each. Evaluated output must not exceed 100,000 vertices or
  50,000 polygons. Excessive results abort the job without publishing
  a new revision.
- All modifiers are **applied immediately** to stored mesh geometry, so the
  browser GLB preview and subsequent revisions use the resulting topology.
- Object UUID is stable across these operations. Existing legacy name
  selectors still work; no free-form modifier scripting.
- TypeScript/MCP and the Python worker independently validate all fields.
  Each batch remains at most 20 operations.

## Limitations

A bevel on degenerate geometry, a Boolean on non-manifold/open geometry,
or a subdivision of unusual topology may produce imperfect results.
The service makes no claim that resulting meshes are watertight. The
input/output complexity checks are per operation, not a total scene mesh
budget; existing worker process limits apply. UV-unwrapping, geometry
repair, extrusion, mirror, array, PBR and materials belong to later steps.

## Verification

CI includes negative Python and TypeScript validation tests, plus a real
headless Blender two-revision scenario that applies all three operations,
checks altered topology and preserved UUIDs, and validates the GLB export.
Live Google/ChatGPT and user-billed Modal runs remain deferred.
