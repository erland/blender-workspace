"""End-to-end in headless Blender: staged native BLEND and textured GLB."""
import json,sys
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from blender_workspace_poc.compose_sources import compose_sources
from blender_workspace_poc.object_identity import PROPERTY,ensure_object_ids

out=Path('/workspace/out')
out.mkdir(exist_ok=True,parents=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
obj=bpy.context.object
obj.name='Native Rex'
material=bpy.data.materials.new('Native olive skin')
material.use_nodes=True
material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.15,.4,.05,1)
obj.data.materials.append(material)
ensure_object_ids(bpy.data.objects)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source-00.blend'),compress=False)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_uv_sphere_add()
obj=bpy.context.object
obj.name='External sphere'
mat=bpy.data.materials.new('External orange')
mat.use_nodes=True
mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.9,.25,.02,1)
obj.data.materials.append(mat)
bpy.ops.export_scene.gltf(filepath=str(out/'source-01.glb'),export_format='GLB')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_plane_add()
bpy.context.object.name='Ground'
(out/'asset-sources.json').write_text(json.dumps([
 {'index':0,'offset':[-3,0,0],'format':'blend'},
 {'index':1,'offset':[3,0,0],'format':'glb'}
]))
result=compose_sources()
assert [x['objectsImported'] for x in result]==[1,1],result
assert {'Native Rex','External sphere','Ground'}<=set(bpy.data.objects.keys())
assert abs(bpy.data.objects['Native Rex'].location.x+3)<.001
assert abs(bpy.data.objects['External sphere'].location.x-3)<.001
assert bpy.data.objects['Native Rex'].data.materials[0].name=='Native olive skin'
assert bpy.data.objects['External sphere'].data.materials[0] is not None
ensure_object_ids(bpy.data.objects)
ids=[o[PROPERTY] for o in bpy.data.objects]
assert len(ids)==len(set(ids))
print('BW_DEV041_EXTERNAL_IMPORT PASS',flush=True)
