# DEV-015 – Multiple scene operations per immutable revision

The model-independent MCP tool `workspace_queue_scene_operation` now accepts either one existing DEV-014 operation **or** a bounded batch, e.g.

```json
{"kind":"batch","operations":[
  {"kind":"add_primitive","name":"Desk top","primitive":"cube","scale":[3,1,0.15]},
  {"kind":"add_primitive","name":"Desk leg","primitive":"cylinder","location":[-1,0,-1]},
  {"kind":"set_color","name":"Desk leg","color":[0.3,0.5,0.8]}
]}
```

A batch contains **1–20** non-nested operations. The same strict allowlist of primitives, names and numeric ranges applies to each item. Initial scene creation requires the **first** operation to add a primitive. All operations execute sequentially in a single short-lived Blender sandbox. A later operation may refer to an object created earlier in the same batch. The worker publishes exactly **one** new immutable revision, with `scene.blend`, `scene.glb` and `scene.json`.

The batch remains a **data-only** instruction. Both TypeScript/Zod and independent Python validators reject nested batches, unknown keys, arbitrary scripts, invalid numbers and oversized operation counts. The trusted Blender script does not persist any new revision until all operations have succeeded; failures prevent artifact publication and leave the previous revision intact. PostgreSQL's existing owner/revision/active-job protections apply unchanged.

This step reduces Modal startup, export and version overhead for multi-object scenes. It is not a general AI-to-mesh service: object creation still consists of five primitive types and limited transforms/material colors. Real Google and owner-specific Modal integration remain deferred.

CI includes simulated Modal and PostgreSQL tests plus a **real headless Blender** create/edit cycle with multiple operations and assertions on scene metadata. The existing DEV-014 single-operation flow remains backward compatible.
