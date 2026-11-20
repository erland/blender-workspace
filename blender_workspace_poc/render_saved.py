"""Render an existing verified Blender revision. No user-edit Python is executed."""
import argparse
from pathlib import Path
import bpy

def render(source,output,engine,width,height,samples):
    if source!='/workspace/out/input.blend' or output!='/workspace/out/render.png':
        raise ValueError('Invalid fixed sandbox paths')
    if engine not in ('BLENDER_EEVEE_NEXT','CYCLES'):
        raise ValueError('Unsupported render engine')
    if not (128<=width<=1024 and 128<=height<=1024 and 1<=samples<=64):
        raise ValueError('Render limits exceeded')
    if engine=='CYCLES' and samples>32:
        raise ValueError('Cycles samples limit exceeded')
    bpy.ops.wm.open_mainfile(filepath=source,load_ui=False,use_scripts=False)
    scene=bpy.context.scene
    if engine=='BLENDER_EEVEE_NEXT':
        supported={item.identifier for item in scene.render.bl_rna.properties['engine'].enum_items}
        scene.render.engine='BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in supported else 'BLENDER_EEVEE'
    else:
        scene.render.engine='CYCLES'
    scene.render.resolution_x=width
    scene.render.resolution_y=height
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.render.filepath=output
    scene.render.film_transparent=False
    if engine=='CYCLES':
        scene.cycles.samples=samples
        if hasattr(scene.cycles,'use_denoising'):
            scene.cycles.use_denoising=True
        scene.render.threads_mode='FIXED'
        scene.render.threads=2
    else:
        # Eevee sampling differs across Blender releases; keep settings bounded.
        scene.render.image_settings.color_mode='RGBA'
    if scene.camera is None:
        # Temporary preview camera, never saved back to the original .blend.
        from mathutils import Vector
        bpy.ops.object.camera_add(location=(6,-8,5))
        camera=bpy.context.object
        direction=Vector((0,0,0))-camera.location
        camera.rotation_euler=direction.to_track_quat('-Z','Y').to_euler()
        camera.data.type='ORTHO'
        camera.data.ortho_scale=9
        scene.camera=camera
    if not any(o.type=='LIGHT' for o in bpy.data.objects):
        bpy.ops.object.light_add(type='AREA',location=(2,-4,8))
        bpy.context.object.data.energy=800
        bpy.context.object.data.shape='DISK'
        bpy.context.object.data.size=7
    bpy.ops.render.render(write_still=True)
    file=Path(output)
    if not file.is_file() or file.stat().st_size<64:
        raise RuntimeError('Render output missing')
    print('BW_SANDBOX_RENDER PASS',flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--source',required=True)
    p.add_argument('--output',required=True)
    p.add_argument('--engine',choices=['BLENDER_EEVEE_NEXT','CYCLES'],required=True)
    p.add_argument('--width',type=int,required=True)
    p.add_argument('--height',type=int,required=True)
    p.add_argument('--samples',type=int,required=True)
    a=p.parse_args()
    render(a.source,a.output,a.engine,a.width,a.height,a.samples)
