# DEV-024 – Bounded custom mesh creation

The generic data-only operation contract supports `add_mesh` to create a
named Blender mesh with arbitrary vertex positions and polygon indices.
It is model-independent and does not execute arbitrary Python.

```json
{
  "kind":"add_mesh",
  "name":"Roof",
  "vertices":[[-2,-2,0],[2,-2,0],[2,2,0],[-2,2,0],[0,0,3]],
  "faces":[[0,3,2,1],[0,1,4],[1,2,4],[2,3,4],[3,0,4]],
  "color":[0.2,0.5,0.8]
}
```

Optional `location`, `rotation`, `scale` and `color` use the existing
bounded transform/material semantics. `add_mesh` may be the first operation
of a new scene, or be added in an edit revision/batch. It creates a normal
Blender mesh with a stable DEV-022 UUID, saved to immutable BLEND, GLB and
scene report artifacts. Subsequent operations use the same name/UUID-based
editing, duplication, hierarchy and recoloring tools.

## Input limits

- 3–1,024 vertices per mesh, finite XYZ coordinates between -100 and 100.
- 1–2,048 polygons, 3–8 vertex indices each, max 8,192 indices in total.
- Every face index must be an integer within the vertex array and unique
  within that face; polygon loops must be nonempty and contain 3+ corners.
- No unknown fields, file paths, raw scripts, recursion or unbounded input.
- A batch still permits up to 20 operations and is subject to the existing
  HTTP 256-KiB request limit. Larger models must be built incrementally.

The server validates with Zod and the worker independently revalidates
before running Blender. The worker uses a fixed `from_pydata` call to build
the mesh without evaluating code from the request. Incorrect/missing
references fail rather than silently referring to another object.

**Limitations:** Not yet a topological mesh editor; geometric validity such
as watertightness and self-intersections is not guaranteed. Explicit UVs,
normals, material slots and modifiers remain separate future capabilities.
Very large/complex scenes are intentionally out of scope for this step.

## Verification

Python and TypeScript tests cover valid custom geometry, bounded numbers,
face arity, duplicate and out-of-range indices, oversized input, unknown
fields and batch compatibility. The real headless Blender regression builds
a custom roof in a *new* scene, saves a blend file and validates the GLB
node and exported UUID. Live personal Modal execution and Google/ChatGPT
end-to-end acceptance remain deferred.
