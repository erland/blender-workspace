# DEV-027 – GLB-compatible PBR materials

A new bounded, typed `set_pbr_material` operation applies a Principled BSDF
material to an existing mesh, addressed by exactly one of `name` or stable
`objectId`. All material factors use linear numeric values between 0 and 1.

```json
{
  "kind": "set_pbr_material",
  "objectId": "<uuid>",
  "baseColor": [0.1, 0.3, 0.6],
  "metallic": 0.8,
  "roughness": 0.2,
  "opacity": 0.55,
  "emissionColor": [0.2, 0.1, 0],
  "emissionStrength": 0.4
}
```

This applies one complete material configuration to the selected object.
The Blender worker creates a dedicated Principled BSDF with Base Color,
Metallic, Roughness, Alpha, Emission Color and Emission Strength parameters.
For opacity below 1, transparent rendering is enabled. GLB exports the
compatible glTF metallic-roughness PBR factors and alpha blend mode for
display in the existing Three.js browser viewer.

An object with shared mesh data gets independent mesh data before modifying
its material slots. The operation creates a new material rather than editing
a shared material in place. The selected object retains its stable UUID and
prior immutable revisions remain unchanged.

## Safety and scope

- Required complete specification: missing factors are rejected (no
  ambiguous implicit defaults).
- Base and emission colors require 3 finite RGB numbers in 0–1.
- Metallic, roughness, opacity and emission strength must be finite 0–1.
- Unknown fields, scripts, textures from URLs, arbitrary nodes and Python
  expressions are not accepted. Both MCP/TypeScript and Python worker
  enforce the independent schema.
- Only MESH objects in the current authorized scene may be edited.
- Uses normal saved BLEND/GLB revisions; browsing/viewing existing GLB
  files does not incur Modal rendering jobs.

## Limitations

No texture maps, UV mapping, external image assets, transmission/refraction
or arbitrary shader graphs yet. Transparency appearance depends on viewer
sorting and GLB support. This operation replaces material assignments on
the selected mesh rather than preserving multiple material slots. The
emission strength limit prevents reliance on optional glTF strength
extensions in this first version.

CI includes negative Python/TypeScript validation tests and a real headless
Blender two-revision regression reading the exported GLB JSON and checking
metallic, roughness, alpha and emission, stable object UUID and material
isolation. Live Google/ChatGPT/Modal and iPad browser visual acceptance
remain deferred.
