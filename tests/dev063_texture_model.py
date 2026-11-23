"""A real two-revision texture asset for the DEV-063 lifecycle smoke."""
from pathlib import Path
import bpy

root = Path('/workspace/out')
image_file = root/'user-upload.png'
pixels = bpy.data.images.new('dev063-source',width=16,height=16)
pixels.pixels[:]=[0.1,0.65,0.2,1.0]*256
pixels.filepath_raw=str(image_file)
pixels.file_format='PNG'
pixels.save()
bpy.data.images.remove(pixels)
texture=bpy.data.images.load(str(image_file),check_existing=False)
texture.name='dev063-texture'
bpy.ops.mesh.primitive_cube_add()
mesh=bpy.context.object
mesh.name='TexturedModel'
mat=bpy.data.materials.new('SharedTextureMaterial')
mat.use_nodes=True
shader=mat.node_tree.nodes.get('Principled BSDF')
node=mat.node_tree.nodes.new('ShaderNodeTexImage')
node.image=texture
mat.node_tree.links.new(node.outputs['Color'],shader.inputs['Base Color'])
mesh.data.materials.append(mat)
