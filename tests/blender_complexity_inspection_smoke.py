"""DEV-044: stored hair, mesh and procedural modifier diagnostics in saved reports.

Runs in the normal headless Blender CI image, no Modal account required.
"""
import json
import sys
from pathlib import Path
import tempfile
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from blender_workspace_poc.common import inspect_scene, write_manifest

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
mesh = bpy.context.object
mesh.name = "Procedural mesh"
modifier = mesh.modifiers.new("Potential geometry nodes", "NODES")
assert modifier.type == "NODES"
curves = bpy.data.hair_curves.new("Native strands")
hair = bpy.data.objects.new("Native hair", curves)
bpy.context.scene.collection.objects.link(hair)
curves.add_curves(sizes=[2, 3, 4])
scene = inspect_scene()
objects = {obj["name"]:obj for obj in scene["objects"]}
m = objects["Procedural mesh"]["complexity"]
assert m["source"] == "stored" and m["evaluated"] is False
assert m["mesh"] == {"vertices":8,"edges":12,"faces":6},m
assert m["proceduralPotential"] is True,m
assert m["modifiers"][0]["type"] == "NODES"
h = objects["Native hair"]["complexity"]
assert h["hair"] == {"curveCount":3,"pointCount":9,"interpolatedCount":None},h
assert h["proceduralPotential"] is False
assert h["evaluated"] is False
with tempfile.TemporaryDirectory() as folder:
    report = Path(folder)/"scene.json"
    fake = Path(folder)/"test.blend"
    fake.write_bytes(b"placeholder")
    write_manifest(report,"dev044",[fake])
    saved = json.loads(report.read_text())
    by_name = {obj["name"]:obj for obj in saved["scene"]["objects"]}
    assert by_name["Native hair"]["complexity"]["hair"]["pointCount"] == 9
    assert by_name["Procedural mesh"]["complexity"]["proceduralPotential"]
print("BW_DEV044_COMPLEXITY PASS",flush=True)
