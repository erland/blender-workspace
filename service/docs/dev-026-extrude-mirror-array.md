# DEV-026 – Bounded extrusion, mirror and array operations

The generic MCP scene-edit tool adds three typed, data-only operations that edit
an existing mesh identified by exactly one of `name` or stable `objectId`.
All three operate in the normal owner-authorized, revision-producing Blender
job. Each saves a new immutable BLEND, GLB and scene metadata report.

```json
{"kind":"extrude_face","objectId":"<uuid>","faceIndex":0,"offset":[0,0,2]}
```

Extrudes a single **polygon by its zero-based polygon index**, displacing the
new geometry by a local-space offset. The object ID is stable; face indices
are **not stable** across topology-changing edits. Inspect the source mesh in
Blender or construct the mesh using a known face order. Offset values must
be finite, between -10 and 10, and not all zero.

```json
{"kind":"mirror_mesh","objectId":"<uuid>","axis":"x"}
```

Applies Blender's Mirror modifier about the object's **local origin**.
Choose one axis x, y or z. Geometry is actually baked into the resulting mesh;
this is not a persistent Blender modifier stack.

```json
{"kind":"array_mesh","objectId":"<uuid>","count":3,"offset":[3,0,0]}
```

Makes 2–8 copies in one mesh using a fixed local-space constant offset.
The displacement is a per-copy step; zero displacement is rejected.
Existing object IDs remain unchanged, since array copies are geometry inside
the same object.

## Safety and limits

- Bounded typed input is checked independently in the TypeScript/MCP service
  and Python worker; unsupported code, fields and commands are rejected.
- Face index 0–39,999, existing in the mesh. Extrusion input is bounded to
  20,000 vertices / 40,000 polygons, output to 100,000 vertices / 50,000 polygons.
- Mirror and array reuse DEV-025's evaluated-geometry limits and abort the
  job before publication on excessive output.
- Only existing mesh objects can be processed. Nothing changes in other
  users' projects or previous immutable revisions.
- These operations can participate in a batch with up to 20 steps.

## Known limitations

Face index references need source mesh topology and may change after any
geometry operation. Mirror uses the object's local origin. Open, non-manifold
or self-intersecting shapes are not automatically repaired. Neither an
editable modifier stack nor simultaneous multiple axes is exposed by this
limited operation contract.

Real headless Blender CI creates a source scene and an edited revision,
verifies that topology changed, UUID identity stayed stable and GLB nodes
contain the edited objects. Live Google/ChatGPT/Modal/billing and iPad
acceptance are still deferred.
