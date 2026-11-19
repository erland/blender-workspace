# DEV-032 — reusable project-local PBR materials

## Decision and scope

Reuse the existing typed operations, per-project immutable BLEND/GLB/JSON
revisions, and existing viewer. No new Modal runtime or server rendering.
Do **not** accept remote texture URLs, filesystem paths, arbitrary Blender
nodes, user scripts, or unrestricted imports via this typed interface.

The existing `import_glb` operation provides a bounded model asset import
(up to 120 KB decoded), and `duplicate_object` already reuses geometry
inside a project. This step extends **material reuse**; it does not create a
cross-project asset library or large-file upload service.

## New typed operations

All operations are sent through `workspace_queue_scene_operation`.
Use a `batch` to create and assign a material in one immutable revision.

- `create_pbr_material` creates a named Principled BSDF PBR material
  with required `materialName`, `baseColor` (RGB 0–1), `metallic`,
  `roughness`, `opacity`, `emissionColor`, `emissionStrength`
  (all scalars 0–1).
- `assign_material` assigns a previously created named **library material**
  to a mesh selected by exactly one of `name` or stable `objectId`.

Example after an initial mesh exists:

```json
{
  "kind": "batch",
  "operations": [
    {
      "kind":"create_pbr_material", "materialName":"Brushed Aluminium",
      "baseColor":[0.35,0.45,0.6], "metallic":0.9,
      "roughness":0.3, "opacity":1.0,
      "emissionColor":[0,0,0], "emissionStrength":0
    },
    {
      "kind":"assign_material", "name":"Desk",
      "materialName":"Brushed Aluminium"
    }
  ]
}
```

The first operation in a newly created scene must still be
`add_primitive`, `add_mesh`, or `import_glb`. To create and assign a
material during scene creation, put the geometry first in the same batch.

Library materials have unique names within a scene (no silent overwrite),
persist in .blend even when temporarily unused, and are limited to 128.
Assignment preserves the material data block for reuse; the selected
object's mesh datablock is copied first if its geometry is shared, so
material changes do not unexpectedly update another mesh object.
Existing `set_pbr_material` remains available for standalone
per-object materials and does not overwrite named library materials.

## Read-only catalog

`workspace_list_materials({projectId,revision})` reads one owned, saved,
checksum-verified scene JSON report. No Modal execution is started.
Returns a `materialLibrary`-derived list with names, actual Principled BSDF
factors and assigned mesh names. Older revisions where the catalog field is
absent return `available:false` rather than synthetic material entries.
Material catalogs are snapshots of specific immutable revisions, not
separately stored, globally accessible data.

## Security and limitations

- TypeScript and worker Python both validate strictly: required PBR
  factors, safe bounded names, no unknown fields, paths, scripts or URLs.
- Only project-local library materials may be assigned by name. Assets from
  another project are **not** available by arbitrary project ID or path.
- The original per-user Modal Sandbox and existing revision ownership checks
  apply to editing jobs. Catalog reads only require existing read scope and
  do not run Blender or Modal.
- Reusable PBR materials export to the GLB alongside mesh geometry when
  referenced. Unassigned library entries remain in the BLEND scene and
  catalog but are not exported into GLB.
- Material assignment replaces the target mesh's existing material slots.
  Multi-slot assignment and per-face material indices are out of scope.
- Image textures, UV editing, material node graphs, external asset download,
  large GLB upload, cross-project reuse and a permanent centralized asset
  registry remain separate future work; this milestone must not be described
  as a full asset management system.

## Offline acceptance

`.github/workflows/material-library-dev032.yml` compiles and tests the
TypeScript/Python schemas and runs the actual Blender worker twice:
revision 1 creates two objects, a named material and assigns it to both;
revision 2 adds another mesh and reuses the same saved material.
The test checks the saved JSON catalog, object names, PBR factors,
BLEND existence and embedded GLB material. No personal Modal account
or live OAuth test is required.

The deferred real-account Modal/MCP and iPad/browser acceptance gate stays
unchanged.
