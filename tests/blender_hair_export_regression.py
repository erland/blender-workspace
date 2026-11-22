"""DEV-043: native Blender hair density, optional GLB, and failure isolation.

Runs inside the existing CI Blender Docker image. No Modal credentials/jobs.
Modern CURVES are authoritative in BLEND; GLB is only a mesh preview.
"""
import hashlib
import json
import sys
from pathlib import Path
from unittest.mock import patch

import bpy

# Blender launches --python scripts with their directory as sys.path[0].
# The repository root must be explicit for importing the trusted worker.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from blender_workspace_poc import apply_python

OUT = Path("/workspace/out")
OUT.mkdir(parents=True, exist_ok=True)
MODEL = OUT / "model.py"
MODEL.write_text("""
import math
import bpy

bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8)
sphere = bpy.context.object
sphere.name = 'Fur carrier'
curves = bpy.data.hair_curves.new('Native fur')
fur = bpy.data.objects.new('Native fur', curves)
bpy.context.scene.collection.objects.link(fur)
fur.parent = sphere
for target in (8, 32, 128, 512):
    curves.add_curves(sizes=[2] * (target - len(curves.curves)))
    assert len(curves.curves) == target
    positions = curves.attributes['position'].data
    for i in range(target):
        angle = i * 2.399963229728653
        z = 1.8 * (i + 0.5) / target - 0.9
        radius = math.sqrt(max(0.0, 1 - z*z))
        for j in range(2):
            positions[2*i+j].vector = (radius*math.cos(angle)*(1+.1*j),
                                      radius*math.sin(angle)*(1+.1*j),
                                      z*(1+.1*j))
    bpy.context.view_layer.update()
    print('BW_DEV043_STRANDS', target, flush=True)
assert len(curves.curves) == 512
""".strip() + "\n", encoding="utf8")

original_argv = sys.argv[:]
try:
    sys.argv = ["apply_python.py", "--", "NEW", str(MODEL), "1"]
    # 1. Normal export: an actual mesh preview should remain usable.
    apply_python.main()
    blend = OUT / "scene.blend"
    glb = OUT / "scene.glb"
    report = OUT / "scene.json"
    assert blend.read_bytes().startswith(b"BLENDER")
    assert glb.is_file(), "A mesh-based scene must produce a GLB preview"
    normal = json.loads(report.read_text())
    assert normal["preview"]["status"] == "available", normal["preview"]
    assert {a["path"] for a in normal["artifacts"]} == {"scene.blend", "scene.glb"}
    assert apply_python.preview_is_structurally_usable(glb)
    assert any(o["type"] == "CURVES" for o in normal["scene"]["objects"])

    # 2. Reload the saved BLEND: native curves must survive regardless of GLB fidelity.
    bpy.ops.wm.open_mainfile(filepath=str(blend), load_ui=False, use_scripts=False)
    native = bpy.data.objects.get("Native fur")
    assert native is not None and native.type == "CURVES"
    assert len(native.data.curves) == 512
    print("BW_DEV043_NATIVE_RELOAD PASS", flush=True)

    # 3. Simulate a deterministic GLB exporter exception in the *actual*
    #    trusted workflow, not in a reimplementation of the export fallback.
    #    The valid native BLEND and report must still be published.
    def fail_export(_path):
        raise RuntimeError("Synthetic GLB exporter failure")

    with patch.object(apply_python, "export_glb", side_effect=fail_export):
        apply_python.main()
    assert blend.read_bytes().startswith(b"BLENDER")
    assert blend.stat().st_size > 256
    assert not glb.exists(), "Stale GLB must not survive a failed export"
    fallback = json.loads(report.read_text())
    assert fallback["preview"]["status"] == "unavailable", fallback["preview"]
    assert fallback["preview"]["reason"] == "export_failed"
    assert {a["path"] for a in fallback["artifacts"]} == {"scene.blend"}
    record = fallback["artifacts"][0]
    assert record["sha256"] == hashlib.sha256(blend.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(blend), load_ui=False, use_scripts=False)
    native = bpy.data.objects.get("Native fur")
    assert native is not None and native.type == "CURVES"
    assert len(native.data.curves) == 512
    print("BW_DEV043_EXPORT_FALLBACK PASS", flush=True)
finally:
    sys.argv = original_argv

print("BW_DEV043_HAIR_EXPORT PASS", flush=True)
