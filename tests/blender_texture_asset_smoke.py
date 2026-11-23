"""DEV-053: real Blender texture source -> PBR material -> packed native BLEND."""
import json
from pathlib import Path
import bpy
from blender_workspace_poc.compose_sources import compose_sources
from blender_workspace_poc.portable_scene import pack_scene_resources

out=Path('/workspace/out')
out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
obj=bpy.context.object
obj.name='Texture Target'
bpy.ops.mesh.primitive_cube_add(location=(3,0,0))
bpy.context.object.name='Untouched Cube'

image=bpy.data.images.new('Scratch',width=8,height=8)
image.pixels[:]=[0.2,0.65,0.8,1]*64
image.filepath_raw=str(out/'source-00.png')
image.file_format='PNG'
image.save()
bpy.data.images.remove(image)
(out/'asset-sources.json').write_text(json.dumps([{
 'index':0,'offset':[0,0,0],'format':'png',
 'texture':{'objectName':'Texture Target','channel':'baseColor'}
}]))
assert compose_sources()==[]
mat=obj.data.materials[0]
bsdf=mat.node_tree.nodes.get('Principled BSDF')
assert bsdf.inputs['Base Color'].is_linked
link=bsdf.inputs['Base Color'].links[0]
assert link.from_node.type=='TEX_IMAGE'
assert link.from_node.image.size[:]==(8,8)
assert len(bpy.data.objects['Untouched Cube'].data.materials)==0

packed=pack_scene_resources()
assert packed['status']=='complete',packed
assert packed['packedCount']>=1,packed
blend=out/'texture-test.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(blend),compress=False)
(out/'source-00.png').unlink()
bpy.ops.wm.open_mainfile(filepath=str(blend),load_ui=False,use_scripts=False)
obj=bpy.data.objects['Texture Target']
bsdf=obj.data.materials[0].node_tree.nodes.get('Principled BSDF')
image=bsdf.inputs['Base Color'].links[0].from_node.image
assert image.packed_file is not None
assert image.packed_file.size>0
assert len(bpy.data.objects['Untouched Cube'].data.materials)==0
print('BW_DEV053_TEXTURE_PACK PASS',flush=True)
