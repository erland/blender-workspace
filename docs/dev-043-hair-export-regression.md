# DEV-043 – Native hair preservation and GLB failure isolation

This step adds a non-billable, real headless Blender regression on top of DEV-042.
It exercises the production `apply_python.main()` path inside the same pinned
Blender Docker image used by CI, not an imitation exporter.

## Assertions

1. Create a UV sphere and modern native CURVES hair in increasing amounts:
   8, 32, 128, and 512 physical strands. Reuse Blender's native CURVES API.
2. Run the normal modeling artifact flow, verify GLB is structurally usable
   for the mesh carrier and verify the report records the CURVES object.
3. Reload the saved `scene.blend`; verify all 512 native strands survive.
4. Force the optional GLB exporter to throw, while running the same production
   artifact flow. Assert `scene.blend` and its SHA-256 manifest survive;
   `scene.glb` is absent and the preview status is explicitly unavailable.
5. Reload the fallback `scene.blend` and verify the same strand count.

All checks run in GitHub Actions without Modal credentials or paid execution.

## Explicit limits

This deliberately tests physical native curves, **not Blender's procedural
interpolated child-hair geometry nodes**, and does not render realistic fur.
GLB preserving the visible hair is neither expected nor claimed: the GLB is
merely a mesh preview, and a native BLEND remains authoritative. This synthetic
test does not diagnose the previously failed cat, and it does not validate
Modal-specific resource limits, timeouts or browser rendering.

Live Modal acceptance is deferred; this regression must pass CI before DEV-043
can be marked code-complete.
