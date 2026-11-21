# MAT-001: Preserve basic PBR material appearance in GLB previews

The saved BLEND is authoritative, with unchanged procedural Cycles materials,
rigging and animations. Optional GLB previews receive a **temporary PBR
projection** of surface materials whose shader graphs are not directly
representable by glTF (e.g., ColorRamp/Noise feeding Principled base color).

- Preserve directly supported unlinked Principled properties and image-texture
  links. Substitute only unsupported material graphs during GLB export.
- For procedural material colors prefer explicitly set non-white material
  diffuse color, then representative ColorRamp colors, then Principled default.
  Preserve basic metallic, roughness and opacity values where available.
- Restore original object-level material slots in a `finally` block and remove
  temporary material objects even on exporter failure. BLEND is saved *before*
  GLB preparation and no rendering/baking job is added.
- Analyze exported glTF JSON for material arrays and primitive assignments,
  recording counts and status in `scene.json.preview.materialCheck`.
  Detection is structural: a material reference may exist even when its
  appearance differs. Fidelity therefore remains `unverified`.
- Material/UV texture baking, sampling complex multilayer shaders and existing
  revision GLB regeneration are **not** included in MAT-001.
- Preview failures never discard or change the native BLEND scene.

Acceptance: headless Blender creates a noise/ramp skin shader with white default
Principled base color, exports it with recognizably green PBR fallback, preserves
a directly supported material, restores original material slots after success
and failure and includes material statistics.
