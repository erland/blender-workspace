import json
import os
import hashlib
from pathlib import Path
import bpy
FRAME_RATE=24
FRAME_END=49
def ensure_output():
    out=Path(os.environ.get('BW_OUTPUT','/workspace/out')).resolve()
    out.mkdir(parents=True,exist_ok=True)
    return out
def save_scene(path):
    bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
def export_glb(path):
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=False,export_animations=True,export_skins=True,export_apply=False)
def inspect_scene():
    objects=[]
    for obj in bpy.data.objects:
        if obj.type in {'MESH','ARMATURE'}:
            objects.append({'name':obj.name,'type':obj.type,'materials':[m.name for m in obj.data.materials] if obj.type=='MESH' else [],'bones':[b.name for b in obj.data.bones] if obj.type=='ARMATURE' else []})
    return {'blender_version':bpy.app.version_string,'fps':bpy.context.scene.render.fps,'frame_start':bpy.context.scene.frame_start,'frame_end':bpy.context.scene.frame_end,'objects':sorted(objects,key=lambda x:x['name']),'actions':sorted(a.name for a in bpy.data.actions),'armature_animation':any(o.type=='ARMATURE' and o.animation_data and o.animation_data.action for o in bpy.data.objects),'render_engine':bpy.context.scene.render.engine}
def artifact_record(path):
    p=Path(path)
    return {'path':p.name,'size_bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
def write_manifest(path,stage,artifacts):
    Path(path).write_text(json.dumps({'schema_version':1,'stage':stage,'scene':inspect_scene(),'artifacts':[artifact_record(p) for p in artifacts]},indent=2,ensure_ascii=False)+'\n')
