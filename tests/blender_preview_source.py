"""CI source scene for a re-export without creating a new model revision."""
from pathlib import Path
import bpy
bpy.ops.mesh.primitive_uv_sphere_add()
obj=bpy.context.object
obj.name='Rex skin'
material=bpy.data.materials.new('Olive procedural skin')
material.use_nodes=True
tree=material.node_tree
bsdf=tree.nodes.get('Principled BSDF')
ramp=tree.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color=(0.12,0.18,0.05,1.0)
ramp.color_ramp.elements[1].color=(0.25,0.40,0.10,1.0)
noise=tree.nodes.new('ShaderNodeTexNoise')
tree.links.new(noise.outputs['Fac'],ramp.inputs['Fac'])
tree.links.new(ramp.outputs['Color'],bsdf.inputs['Base Color'])
obj.data.materials.append(material)
# Original is the authoritative unchanged scene.
bpy.ops.wm.save_as_mainfile(filepath='/workspace/out/input.blend',compress=False)
print('BW_PREVIEW_SOURCE PASS',flush=True)
