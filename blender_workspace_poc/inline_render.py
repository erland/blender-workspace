"""Optional, bounded Cycles preview in the existing modeling Blender process.

The authoritative BLEND is already saved before this function runs. Camera,
lighting and render settings are preview-only and never written back to BLEND.
"""
from pathlib import Path
import bpy
from blender_workspace_poc.preview_setup import frame_model, add_preview_lighting


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
    add_preview_lighting(scene,camera)
    bpy.ops.render.render(write_still=True)
    file=Path(output)
    if not file.is_file() or file.stat().st_size<100:
        raise RuntimeError('Preview render unavailable')
    return {'format':'png','status':'available','engine':'CYCLES',
            'width':512,'height':512,'samples':16,'framing':'auto-stored-bounds'}
