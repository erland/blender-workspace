"""Optional, bounded Cycles preview in the existing modeling Blender process.

The authoritative BLEND is already saved before this function runs. Camera,
lighting and render settings are preview-only and never written back to BLEND.
"""
from pathlib import Path
from mathutils import Vector
import bpy


def scene_bounds():
    """Bounds of real renderable objects; avoid triggering procedural evaluation."""
    corners = []
    for obj in bpy.context.scene.objects:
        if obj.type not in {'MESH', 'CURVE', 'SURFACE', 'META', 'FONT', 'CURVES', 'POINTCLOUD', 'VOLUME'}:
            continue
        if obj.hide_render:
            continue
        # Stored object bounds need no evaluated depsgraph. Unknown procedural
        # expansions may lie outside the camera; never claim perfect framing.
        try:
            if obj.type == 'CURVES' and not len(obj.data.points):
                continue
            for corner in obj.bound_box:
                corners.append(obj.matrix_world @ Vector(corner))
        except (AttributeError, RuntimeError, TypeError):
            continue
    return corners


def frame_model(scene):
    """Frame about 80% of 512-square image with a three-quarter camera."""
    points = scene_bounds()
    if not points:
        raise ValueError('No known renderable bounds')
    lo = Vector(tuple(min(point[i] for point in points) for i in range(3)))
    hi = Vector(tuple(max(point[i] for point in points) for i in range(3)))
    center = (lo + hi) * .5
    span = max((hi - lo).length, .1)
    view = Vector((1, -1.3, .75)).normalized()
    position = center + view * max(span * 2.2, 4.)
    bpy.ops.object.camera_add(location=position)
    camera = bpy.context.object
    camera.name = 'Temporary preview camera'
    camera.rotation_euler = (center - position).to_track_quat('-Z','Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.clip_end = max(1000, span * 20)
    right = camera.rotation_euler.to_quaternion() @ Vector((1, 0, 0))
    up = camera.rotation_euler.to_quaternion() @ Vector((0, 1, 0))
    horizontal = max(point.dot(right) for point in points) - min(point.dot(right) for point in points)
    vertical = max(point.dot(up) for point in points) - min(point.dot(up) for point in points)
    camera.data.ortho_scale = max(horizontal, vertical, .1) / .78
    scene.camera = camera
    return camera


def render_inline(output):
    """Render 512² Cycles, 16 samples, CPU-only. Raises on failed preview."""
    if Path(output).name != 'scene.png':
        raise ValueError('Invalid inline preview output')
    scene = bpy.context.scene
    camera = frame_model(scene)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    if hasattr(scene.cycles,'use_denoising'):
        scene.cycles.use_denoising = True
    scene.cycles.device = 'CPU'
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 2
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.filepath = str(output)
    scene.render.film_transparent = False
    if not any(obj.type == 'LIGHT' and not obj.hide_render for obj in scene.objects):
        bpy.ops.object.light_add(type='AREA', location=camera.location + Vector((-2,1,3)))
        key=bpy.context.object
        key.name = 'Temporary preview light'
        key.data.energy=900
        key.data.shape='DISK'
        key.data.size=max(4, camera.data.ortho_scale * 1.4)
    bpy.ops.render.render(write_still=True)
    file=Path(output)
    if not file.is_file() or file.stat().st_size<100:
        raise RuntimeError('Preview render unavailable')
    return {'format':'png','status':'available','engine':'CYCLES',
            'width':512,'height':512,'samples':16,'framing':'auto-stored-bounds'}
