"""Run with Blender: actual glTF export and lossless BLEND isolation."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import struct
import bpy

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from blender_workspace_poc.common import export_glb
from blender_workspace_poc.glb_material_fallback import (
    glb_material_fallback, needs_pbr_fallback, source_material_stats
)


def gltf(path):
    payload=Path(path).read_bytes()
    assert payload[:4]==b'glTF'
    length, kind=struct.unpack_from('<I4s', payload,12)
    assert kind==b'JSON'
    return json.loads(payload[20:20+length])


# Realistic procedural skin setup: ColorRamp -> Principled, with white
# Principled default base color. The current exporter may otherwise use white.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_uv_sphere_add()
body=bpy.context.object
body.name='Rex skin'
mat=bpy.data.materials.new('Procedural olive')
mat.use_nodes=True
mat.diffuse_color=(1,1,1,1)
tree=mat.node_tree
bsdf=tree.nodes.get('Principled BSDF')
ramp=tree.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color=(0.12,0.19,0.055,1)
ramp.color_ramp.elements[1].color=(0.30,0.38,0.14,1)
noise=tree.nodes.new('ShaderNodeTexNoise')
tree.links.new(noise.outputs['Fac'],ramp.inputs['Fac'])
tree.links.new(ramp.outputs['Color'],bsdf.inputs['Base Color'])
body.data.materials.append(mat)
assert needs_pbr_fallback(mat)
bpy.ops.mesh.primitive_cube_add(location=(4,0,0))
other=bpy.context.object
other.name='Supported bronze'
normal=bpy.data.materials.new('Supported bronze material')
normal.use_nodes=True
normal.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(0.55,0.21,0.07,1)
other.data.materials.append(normal)
assert not needs_pbr_fallback(normal)
originals=[(o.name,tuple((s.link,s.material.name if s.material else None) for s in o.material_slots))
           for o in bpy.data.objects if o.type=='MESH']
original_count=len(bpy.data.materials)
with TemporaryDirectory() as tmp:
    with glb_material_fallback() as metrics:
        assert metrics['fallbackMaterials']==1,metrics
        assert body.material_slots[0].material.name.startswith('GLB fallback')
        assert other.material_slots[0].material==normal
        export_glb(Path(tmp)/'scene.glb')
    doc=gltf(Path(tmp)/'scene.glb')
    materials=doc.get('materials',[])
    assert len(materials)>=2,materials
    fallback=next(x for x in materials if x['name'].startswith('GLB fallback'))
    factor=fallback['pbrMetallicRoughness']['baseColorFactor']
    assert factor[1]>factor[0] and factor[0]<0.6,factor
    assert sum('material' in p for m in doc['meshes'] for p in m['primitives'])>=2
    assert source_material_stats()['sourceMaterials']==2
    assert originals==[(o.name,tuple((s.link,s.material.name if s.material else None) for s in o.material_slots))
                       for o in bpy.data.objects if o.type=='MESH']
    assert len(bpy.data.materials)==original_count
    # An exporter failure must still restore material slots and remove copies.
    try:
        with glb_material_fallback():
            raise RuntimeError('export interrupted')
    except RuntimeError:
        pass
    assert len(bpy.data.materials)==original_count
    assert body.material_slots[0].material==mat
print('BW_MAT001_MATERIAL_FALLBACK PASS')
