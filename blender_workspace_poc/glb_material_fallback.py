"""Temporary GLB-compatible material projection; never changes saved BLEND.

Procedural Blender shaders cannot generally be represented by glTF PBR. Only
materials with incompatible surface/base-color node paths are substituted,
and only for the duration of the optional GLB export. Existing supported
Principled/image-texture materials are left untouched.
"""
from contextlib import contextmanager
import bpy


def _near_white(rgb):
    return all(float(v) >= 0.95 for v in rgb[:3])


def _surface_bsdf(material):
    if not material.use_nodes or not material.node_tree:
        return None, False
    nodes = material.node_tree.nodes
    output = next((n for n in nodes if n.type == 'OUTPUT_MATERIAL'
                   and getattr(n, 'is_active_output', True)), None)
    if output is None:
        return None, False
    socket = output.inputs.get('Surface')
    if socket is None or not socket.is_linked:
        return None, False
    node = socket.links[0].from_node
    return (node if node.type == 'BSDF_PRINCIPLED' else None), True


def needs_pbr_fallback(material):
    bsdf, linked = _surface_bsdf(material)
    if not material.use_nodes:
        return False  # glTF exporter handles diffuse_color on non-node materials
    if not linked:
        return True
    if bsdf is None:
        return True
    # Non-image procedural paths require baking to reproduce; use stable
    # PBR factors rather than silently letting glTF default to white.
    for name in ('Base Color', 'Metallic', 'Roughness', 'Alpha'):
        socket = bsdf.inputs.get(name)
        if socket is not None and socket.is_linked:
            upstream = socket.links[0].from_node
            if not (name == 'Base Color' and upstream.type == 'TEX_IMAGE'):
                return True
    return False


def _representative_rgb(material, bsdf):
    # Prefer an explicitly set material preview color if meaningful.
    diffuse = tuple(float(v) for v in material.diffuse_color[:3])
    if not _near_white(diffuse):
        return diffuse
    # Most procedural skin shaders drive Principled Base Color with a
    # ColorRamp. Use ramp colors to keep recognizable skin tones in GLB.
    if material.node_tree:
        ramps = [n for n in material.node_tree.nodes if n.type == 'VALTORGB']
        if ramps:
            colors = [tuple(float(c) for c in stop.color[:3])
                      for ramp in ramps for stop in ramp.color_ramp.elements]
            if colors:
                return tuple(sum(rgb[i] for rgb in colors) / len(colors)
                             for i in range(3))
    if bsdf is not None:
        color = bsdf.inputs.get('Base Color')
        if color is not None:
            return tuple(float(v) for v in color.default_value[:3])
    return diffuse


def _value(bsdf, name, default):
    if bsdf is None:
        return default
    socket = bsdf.inputs.get(name)
    return float(socket.default_value) if socket is not None else default


def _make_fallback(original):
    bsdf, _ = _surface_bsdf(original)
    rgba = _representative_rgb(original, bsdf)
    material = bpy.data.materials.new('GLB fallback - ' + original.name)
    material.use_nodes = True
    material.diffuse_color = (*rgba, 1.0)
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*rgba, 1.0)
    shader.inputs['Metallic'].default_value = max(0.0, min(1.0, _value(bsdf, 'Metallic', 0.0)))
    shader.inputs['Roughness'].default_value = max(0.0, min(1.0, _value(bsdf, 'Roughness', 0.75)))
    alpha = max(0.0, min(1.0, _value(bsdf, 'Alpha', float(original.diffuse_color[3]))))
    shader.inputs['Alpha'].default_value = alpha
    if alpha < 1.0:
        if hasattr(material, 'surface_render_method'):
            material.surface_render_method = 'DITHERED'
        elif hasattr(material, 'blend_method'):
            material.blend_method = 'BLEND'
    return material


def source_material_stats():
    meshes = [obj for obj in bpy.data.objects if obj.type == 'MESH']
    materials = {slot.material.name for obj in meshes
                 for slot in obj.material_slots if slot.material is not None}
    slots = sum(slot.material is not None for obj in meshes for slot in obj.material_slots)
    return {'sourceMaterials': len(materials), 'sourceMaterialSlots': slots}


@contextmanager
def glb_material_fallback():
    """Temporarily replace only incompatible materials with export-safe PBR."""
    saved = []
    created = []
    substitutes = {}
    try:
        for obj in bpy.data.objects:
            if obj.type != 'MESH':
                continue
            for index, slot in enumerate(obj.material_slots):
                original = slot.material
                if original is None or not needs_pbr_fallback(original):
                    continue
                key = original.as_pointer()
                if key not in substitutes:
                    fallback = _make_fallback(original)
                    substitutes[key] = fallback
                    created.append(fallback)
                saved.append((obj, index, slot.link, original))
                slot.link = 'OBJECT'  # no shared mesh datablock mutation
                slot.material = substitutes[key]
        yield {'fallbackMaterials': len(substitutes)}
    finally:
        for obj, index, link, material in reversed(saved):
            slot = obj.material_slots[index]
            slot.link = link
            slot.material = material
        for material in created:
            bpy.data.materials.remove(material, do_unlink=True)
