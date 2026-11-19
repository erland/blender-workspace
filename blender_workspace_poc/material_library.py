"""Reusable, bounded named PBR material library within a saved Blender project.

Materials live in the BLEND scene and are never loaded from user-supplied URLs,
paths, node expressions or scripts. GLB exports referenced materials normally.
"""
import math
import bpy

PROPERTY="bw_library_material"
MAX_LIBRARY_MATERIALS=128

def _material_count():
    return sum(bool(m.get(PROPERTY)) for m in bpy.data.materials)

def create_library_material(operation):
    name=operation['materialName']
    if bpy.data.materials.get(name) is not None:
        raise ValueError('Material name already exists')
    if _material_count()>=MAX_LIBRARY_MATERIALS:
        raise ValueError('Material library limit exceeded')
    material=bpy.data.materials.new(name)
    material.use_nodes=True
    material.use_fake_user=True  # Keep even if it has no mesh users yet.
    rgba=tuple(operation['baseColor'])+(operation['opacity'],)
    material.diffuse_color=rgba
    bsdf=material.node_tree.nodes.get('Principled BSDF')
    if bsdf is None:
        raise ValueError('Blender Principled BSDF unavailable')
    bsdf.inputs['Base Color'].default_value=rgba
    bsdf.inputs['Metallic'].default_value=operation['metallic']
    bsdf.inputs['Roughness'].default_value=operation['roughness']
    bsdf.inputs['Alpha'].default_value=operation['opacity']
    bsdf.inputs['Emission Color'].default_value=tuple(operation['emissionColor'])+(1.0,)
    bsdf.inputs['Emission Strength'].default_value=operation['emissionStrength']
    if operation['opacity']<1:
        if hasattr(material,'surface_render_method'):
            material.surface_render_method='DITHERED'
        elif hasattr(material,'blend_method'):
            material.blend_method='BLEND'
    material[PROPERTY]=True
    return material

def assign_library_material(obj,material_name):
    if obj.type!='MESH':
        raise ValueError('Material assignment requires a mesh')
    material=bpy.data.materials.get(material_name)
    if material is None or material.get(PROPERTY) is not True:
        raise ValueError('Named library material not found')
    # Keep previous users of a shared mesh datablock unchanged.
    if obj.data.users>1:
        obj.data=obj.data.copy()
    obj.data.materials.clear()
    obj.data.materials.append(material)
    return obj

def describe_material_library():
    items=[]
    for mat in sorted(bpy.data.materials,key=lambda value:value.name):
        if not mat.get(PROPERTY):
            continue
        if not mat.use_nodes or mat.node_tree is None:
            continue
        bsdf=mat.node_tree.nodes.get('Principled BSDF')
        if bsdf is None:
            continue
        def scalar(key):
            result=float(bsdf.inputs[key].default_value)
            if not math.isfinite(result):
                raise ValueError('Invalid material factor')
            return result
        def rgb(key):
            return [float(v) for v in bsdf.inputs[key].default_value[:3]]
        base=rgb('Base Color')
        emission=rgb('Emission Color')
        items.append({
            'name':mat.name,
            'baseColor':base,
            'metallic':scalar('Metallic'),
            'roughness':scalar('Roughness'),
            'opacity':scalar('Alpha'),
            'emissionColor':emission,
            'emissionStrength':scalar('Emission Strength'),
            'usedBy':[o.name for o in bpy.data.objects if o.type=='MESH' and
                      any(m==mat for m in o.data.materials)][:512]
        })
        if len(items)>MAX_LIBRARY_MATERIALS:
            raise ValueError('Library material snapshot exceeds limit')
    return items
