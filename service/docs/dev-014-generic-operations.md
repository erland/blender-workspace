# DEV-014 – General structured Blender scene operations

Blender Workspace is intended to create arbitrary 3D models, not just monsters. This step provides the **first genuinely model-independent creation/editing pipeline** based on data-only operations.

## Public MCP tool

`workspace_queue_scene_operation` accepts `projectId`, `expectedRevision`, a typed `operation`, and an optional note. Only the authenticated owner may queue jobs, and existing concurrency and revision checks are enforced. A real user-scoped Modal account is required in configured multiuser operation. Accepted operations:

- `{kind:"add_primitive",name:"Office chair base",primitive:"cube",location:[0,0,0],scale:[1,1,1],color:[0.4,0.4,0.4]}`
- `{kind:"set_transform",name:"Office chair base",location:[1,0,0],scale:[1,1,2],rotation:[0,0,0]}`
- `{kind:"set_color",name:"Office chair base",color:[0,0.4,1]}`
- `{kind:"delete_object",name:"Office chair base"}`

Primitive choices are cube, sphere, cylinder, cone and torus. The first revision requires adding a primitive; subsequent revisions can perform any allowed operation. Existing named objects are selected from the actual scene by object name, not by demo-specific names. Names, numeric ranges and exact keys are validated in TypeScript and independently in Python before allocating Modal.

## Internal execution and artifacts

The validated `operation_spec` is saved with the PostgreSQL job in migration `006_generic_scene_operations.sql`. The dispatcher claims the job and reads its immutable, SHA-256-verified previous scene. For a new generic project there is no source .blend. The worker transfers a JSON operation document (and optional previous `scene.blend`) into the Modal sandbox and invokes only a **fixed trusted** Blender script, `blender_workspace_poc/apply_operation.py`. No user Python or shell commands are executed.

Each generic revision publishes the same stable artifact names `scene.blend`, `scene.glb`, `scene.json` in its immutable revision directory. `workspace_inspect_scene` from DEV-013 reads the scene.json report. The older monster demo path and `monster_vN.*` artifacts remain operational for regression compatibility and will be deprecated separately; the new pipeline does not use them.

**Boundaries:** DEV-014 supports only five primitive geometries and one data-only operation per revision. It does not claim to model arbitrary complex geometry from a free-form prompt, import external assets, create arbitrary mesh topology or edit every Blender property. The architecture and user-facing operations are model-independent and expandable without hardcoding a particular type of model.

## Tests and acceptance

CI validates strict operations, PostgreSQL job persistence, ownership and immutable sequential revisions, mocked Modal uploads and lifecycle, and both Docker builds. Real Google login, personal Modal billing and live end-to-end Blender execution remain intentionally deferred.
