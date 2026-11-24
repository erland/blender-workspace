"""Preview-only camera and illumination helpers.

All generated objects are transient and must not be saved to the source BLEND.
"""
import math
import bpy
from mathutils import Vector

RENDERABLE = {'MESH','CURVE','SURFACE','META','FONT','CURVES','POINTCLOUD','VOLUME'}

def scene_bounds(scene):
    points=[]
    for obj in scene.objects:
        if obj.type not in RENDERABLE or obj.hide_render:
            continue
        try:
            for p in obj.bound_box:
                q=obj.matrix_world @ Vector(p)
                if all(math.isfinite(v) for v in q):
                    points.append(q)
        except (AttributeError, RuntimeError, TypeError, ValueError):
            continue
    return points

def bounds_center_span(scene):
    points=scene_bounds(scene)
    if not points:
        raise ValueError('No known renderable bounds')
    lo=Vector(tuple(min(p[i] for p in points) for i in range(3)))
    hi=Vector(tuple(max(p[i] for p in points) for i in range(3)))
    return points,(lo+hi)*.5,max((hi-lo).length,.1)

def frame_model(scene, aspect=1.0):
    """Frame renderable scene from a three-quarter camera, including offset assets."""
    points,center,span=bounds_center_span(scene)
    view=Vector((1,-1.3,.75)).normalized()
    position=center+view*max(span*2.2,4.0)
    bpy.ops.object.camera_add(location=position)
    camera=bpy.context.object
    camera.name='Temporary preview camera'
    camera.rotation_euler=(center-position).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO'
    camera.data.clip_end=max(1000,span*20)
    right=camera.rotation_euler.to_quaternion() @ Vector((1,0,0))
    up=camera.rotation_euler.to_quaternion() @ Vector((0,1,0))
    horizontal=max(p.dot(right) for p in points)-min(p.dot(right) for p in points)
    vertical=max(p.dot(up) for p in points)-min(p.dot(up) for p in points)
    # Ortho scale specifies vertical visible span in Blender.
    camera.data.ortho_scale=max(vertical,horizontal/max(aspect,1e-6),.1)/.78
    scene.camera=camera
    return camera

def add_preview_lighting(scene,camera=None):
    """Use a scale-independent sun and soft world fill, but honor authored lights."""
    if any(o.type=='LIGHT' and not o.hide_render for o in scene.objects):
        return False
    bpy.ops.object.light_add(type='SUN',location=(0,0,0))
    sun=bpy.context.object
    sun.name='Temporary preview sun'
    sun.rotation_euler=(math.radians(32),math.radians(-28),math.radians(-36))
    sun.data.energy=2.0
    sun.data.angle=math.radians(12)
    # Do not mutate the source world: create a preview-only copy.
    world=scene.world.copy() if scene.world else bpy.data.worlds.new('Temporary preview world')
    world.name='Temporary preview world'
    scene.world=world
    world.use_nodes=True
    background=world.node_tree.nodes.get('Background')
    if background is None:
        background=world.node_tree.nodes.new('ShaderNodeBackground')
        output=world.node_tree.nodes.get('World Output') or world.node_tree.nodes.new('ShaderNodeOutputWorld')
        world.node_tree.links.new(background.outputs['Background'],output.inputs['Surface'])
    background.inputs['Color'].default_value=(.45,.53,.64,1)
    background.inputs['Strength'].default_value=.65
    return True
