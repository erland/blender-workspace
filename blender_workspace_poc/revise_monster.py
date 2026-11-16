"""Reopen the saved Blender scene and produce a recolored revision."""
import time
import bpy
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from blender_workspace_poc.common import ensure_output,save_scene,export_glb,write_manifest
t0=time.monotonic()
out=ensure_output()
original=out/'monster_v1.blend'
if not original.is_file(): raise FileNotFoundError(original)
bpy.ops.wm.open_mainfile(filepath=str(original),load_ui=False)
material=bpy.data.materials.get('Monster_Green')
if material is None: raise RuntimeError('Body material missing')
material.diffuse_color=(0.10,0.26,0.90,1.0)
bsdf=material.node_tree.nodes.get('Principled BSDF')
if bsdf: bsdf.inputs['Base Color'].default_value=(0.10,0.26,0.90,1.0)
material.name='Monster_Blue'
if bpy.data.actions.get('WalkCycle') is None:
    raise RuntimeError('WalkCycle lost after reload')
blend=out/'monster_v2.blend'
glb=out/'monster_v2.glb'
save_scene(blend)
export_glb(glb)
write_manifest(out/'monster_v2.json','revised',[blend,glb])
print(f'BW_METRIC stage=revise duration_seconds={time.monotonic()-t0:.3f}')
