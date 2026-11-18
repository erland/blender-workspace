# DEV-013 – Generic scene/object contract and inspection

Blender Workspace is a **general-purpose 3D scene service**. The cube monster is a development fixture only. No public MCP operation should assume that the user's scene contains Body, legs, eyes, bones, or a particular scene theme.

This step introduces a model-independent `SceneDescription` object model and the read-only `workspace_inspect_scene(projectId, revision)` MCP tool, which reads the **saved scene report associated with an owned, completed project revision**. Its object list comes from the real scene, and may contain arbitrary names and object types (meshes, lights, cameras, empties, armatures, etc.). Where available it exposes materials, parent name, local position, Euler rotation and scale, as well as frame range and action names.

The existing DEV-001–012 Blender report schema (`schema_version: 1`, `scene.objects`) remains readable. The Blender report producer now captures **all objects**, not only meshes and armatures, and adds optional local transforms and parents. The report is not a live query of Blender; it is a **snapshot produced during that saved revision**.

The service checks the authenticated project owner and revision metadata before access. It verifies immutable artifact SHA-256 checksums and size limits before parsing exactly one JSON scene report. A missing, ambiguous, corrupt or oversized report fails without returning unverified scene data. Filenames are not hardcoded; no user-supplied filesystem paths are accepted.

`workspace_inspect_scene` is intentionally read-only. It does not turn arbitrary operations into executable Python code and does not change model geometry. DEV-012's older fixed `Body` edit and DEV-001's monster demo remain in place temporarily for regression compatibility; they must be removed or migrated when general creation and manipulation tools replace them. Do not describe these legacy tools as generic.

**Next development step:** generic typed operations on object identifiers returned by `workspace_inspect_scene` (for example primitive creation and absolute transform/material changes) with authorization, immutable revision jobs, and bounded server-side Blender execution. Do not build more monster-specific tools.

Real Google/ChatGPT and personal Modal billing/execution verification remain deferred, as requested.
