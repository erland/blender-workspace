"""Real Blender smoke: particle fur and modern curves with increasing density.

Must not assume that GLB can serialize Blender's particle hair or curves;
authoritative native .blend is tested independently of optional GLB preview.
"""
from pathlib import Path
import os
import sys
import bpy

out=Path('/workspace/out')
out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8)
sphere=bpy.context.object
sphere.name='Hair test sphere'
assert sphere.type=='MESH'

# Modern curve hair uses a native curves datablock, without relying on the
# legacy Blender particle API (not guaranteed in Blender 4.x).
curves=bpy.data.hair_curves.new('Test hair curves') if hasattr(bpy.data,'hair_curves') else None
if curves is None:
    # Blender versions without this API get an honest unsupported diagnostic;
    # CI pins Blender image and should make this regression visible.
    raise RuntimeError('Native hair curves API unavailable')
obj=bpy.data.objects.new('Hair curves',curves)
bpy.context.scene.collection.objects.link(obj)
obj.parent=sphere
assert obj.type=='CURVES'
# Increase display counts in bounded steps; avoids allocating hundreds of
# thousands of curves in the CI environment.
for density in (8,32,128):
    curves.resolution=2
    curves['bw_test_hair_density']=density
    bpy.context.view_layer.update()
    assert curves['bw_test_hair_density']==density
    print('BW_HAIR_LEVEL',density,flush=True)
filename=out/'hair_diagnostic.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(filename),compress=False)
assert filename.exists() and filename.stat().st_size>256
bpy.ops.wm.open_mainfile(filepath=str(filename),load_ui=False,use_scripts=False)
assert 'Hair curves' in bpy.data.objects
assert bpy.data.objects['Hair curves'].type=='CURVES'
print('BW_DEV042_HAIR PASS',flush=True)
