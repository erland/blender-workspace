# DEV-016 – Duplicate existing mesh objects

Blender Workspace supports model-independent `duplicate_object` in the existing
`workspace_queue_scene_operation` MCP tool. It works both individually on
an existing revision and within a bounded batch, after its source object exists.

```json
{"kind":"batch","operations":[
  {"kind":"add_primitive","name":"Leg","primitive":"cylinder","scale":[0.2,0.2,2]},
  {"kind":"duplicate_object","source":"Leg","name":"Leg 2","location":[2,0,0]},
  {"kind":"set_color","name":"Leg 2","color":[0.8,0.1,0.1]}
]}
```

A duplicate requires a named existing **mesh** as source, and a distinct
unused target name. Optional `location`, `scale` and `rotation` are absolute
local object transforms, in Blender units and radians. Omitted values inherit
the source object's transforms. Duplication creates a separate mesh datablock,
so later mesh data edits cannot change the original. Material color edits
copy their material before updating it. Copied objects are made top-level
(scene parent cleared); this operation does not clone a full hierarchy.

Both TypeScript and Python validate names, allowed fields and finite bounded
transform values. The worker resolves the source object from its current
Blender scene, never from an untrusted path. A missing source, non-mesh source
or occupied target name aborts the job without publishing a new revision.
Every batch remains limited to 1–20 ordered data-only operations and yields
a single immutable revision. This does not accept arbitrary Python code.

Verification: TypeScript schema tests, Python tests, existing PostgreSQL/MCP
regressions, and the headless Blender workflow that creates an object,
duplicates it into a later revision, modifies the duplicate and checks
the original remains present and unchanged.

Live Google/ChatGPT and user-billed Modal acceptance remain deferred.
