"""DEV-060: a real Blender scene must reload image bytes from external storage."""
import hashlib
import sys
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from blender_workspace_poc.portable_scene import pack_scene_resources
from blender_workspace_poc.external_resources import externalize_image_textures

root=Path('/workspace/out')
root.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
source=root/'temporary-source.png'
image=bpy.data.images.new('Persistent',width=8,height=8)
image.pixels[:]=[0.1,0.7,0.3,1.0]*64
image.filepath_raw=str(source)
image.file_format='PNG'
image.save()
bpy.data.images.remove(image)
loaded=bpy.data.images.load(str(source),check_existing=False)
bpy.ops.mesh.primitive_cube_add()
mesh=bpy.context.object
mat=bpy.data.materials.new('From external')
mat.use_nodes=True
shader=mat.node_tree.nodes.get('Principled BSDF')
node=mat.node_tree.nodes.new('ShaderNodeTexImage')
node.image=loaded
mat.node_tree.links.new(node.outputs['Color'],shader.inputs['Base Color'])
mesh.data.materials.append(mat)
portable=pack_scene_resources()
assert portable['status']=='complete',portable
records=externalize_image_textures()
assert len(records)==1,records
assert records[0]['name'].startswith('resources/')
assert records[0]['sha256']==hashlib.sha256((root/records[0]['name']).read_bytes()).hexdigest()
assert loaded.packed_file is None
blend=root/'input.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(blend),compress=False)
source.unlink()
bpy.ops.wm.open_mainfile(filepath=str(blend),load_ui=False,use_scripts=False)
image=bpy.data.objects['Cube'].data.materials[0].node_tree.nodes.get('Image Texture').image
assert image is not None
assert image.packed_file is None
assert image.filepath=='//'+records[0]['name']
image.reload()
assert Path(bpy.path.abspath(image.filepath)).is_file()
assert image.size[:]==(8,8)
assert abs(image.pixels[1]-0.7)<0.05
# A subsequent modeling revision can reopen the same image and preserve it.
assert bpy.data.objects['Cube'].data.materials[0].node_tree.nodes.get('Image Texture').image==image
print('BW_DEV060_EXTERNAL_IMAGE_RELOAD PASS',flush=True)
