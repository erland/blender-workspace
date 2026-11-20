"""Render an existing verified Blender revision. No user-edit Python is executed."""
import argparse
import json
import math
import sys
from pathlib import Path
import bpy

def apply_viewer_camera(scene, data):
    """Convert glTF/Three Y-up camera to Blender Z-up without saving the scene."""
    from mathutils import Matrix, Vector
    if not isinstance(data, dict) or set(data) != {
            'type','position','target','up','verticalFovDegrees'}:
        raise ValueError('Invalid camera payload')
    if data['type'] != 'perspective':
        raise ValueError('Unsupported camera type')
    def vec(name):
        v = data[name]
        if not isinstance(v, list) or len(v)!=3 or not all(
                type(x) in (int,float) and math.isfinite(x) and abs(x)<=1e6 for x in v):
            raise ValueError('Invalid camera vector')
        # Blender (X,Y,Z) -> glTF (X,Z,-Y); inverse is (X,-Z,Y).
        return Vector((v[0],-v[2],v[1]))
    position,target,up=vec('position'),vec('target'),vec('up')
    fov=data['verticalFovDegrees']
    if type(fov) not in (int,float) or not math.isfinite(fov) or not 10<=fov<=100:
        raise ValueError('Invalid camera FOV')
    back=position-target
    if back.length<1e-5 or not 0.5<=up.length<=2:
        raise ValueError('Degenerate camera')
    back.normalize()
    right=up.cross(back)
    if right.length<0.01*up.length:
        raise ValueError('Parallel camera up')
    right.normalize()
    actual_up=back.cross(right).normalized()
    matrix=Matrix(((right.x,actual_up.x,back.x),
                   (right.y,actual_up.y,back.y),
                   (right.z,actual_up.z,back.z)))
    bpy.ops.object.camera_add(location=position)
    camera=bpy.context.object
    camera.rotation_euler=matrix.to_quaternion().to_euler()
    camera.data.type='PERSP'
    camera.data.sensor_fit='VERTICAL'
    camera.data.sensor_height=36
    camera.data.lens=36/(2*math.tan(math.radians(fov)/2))
    scene.camera=camera

def render(source,output,engine,width,height,samples,camera_json=None):
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
    if camera_json is not None:
        apply_viewer_camera(scene,json.loads(camera_json))
    elif scene.camera is None:
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
    p.add_argument('--camera-json',default=None)
    # Blender exposes its own CLI flags in sys.argv. User script flags follow '--'.
    # Never parse Blender flags as rendering options or silently lose them.
    if '--' not in sys.argv:
        p.error("missing '--' separator for render options")
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
    render(a.source,a.output,a.engine,a.width,a.height,a.samples,a.camera_json)
