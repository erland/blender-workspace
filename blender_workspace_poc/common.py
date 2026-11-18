import json
import os
import hashlib
from pathlib import Path
import bpy
from blender_workspace_poc.object_identity import ensure_object_ids,PROPERTY
FRAME_RATE=24
FRAME_END=49
def ensure_output():
    out=Path(os.environ.get('BW_OUTPUT','/workspace/out')).resolve()
    out.mkdir(parents=True,exist_ok=True)
    return out
def save_scene(path):
    ensure_object_ids(bpy.data.objects)
    bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
def export_glb(path):
    ensure_object_ids(bpy.data.objects)
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=False,export_animations=True,export_skins=True,export_apply=False,export_extras=True)
def inspect_scene():
    # Report the actual Blender scene. Object names/types are not constrained
    # by the demo model and are never inferred from filename conventions.
    objects=[]
    for obj in bpy.data.objects:
        objects.append({
            'name':obj.name,
            'objectId':obj.get(PROPERTY),
            'type':obj.type,
            'parent':obj.parent.name if obj.parent else None,
            'materials':[m.name for m in obj.data.materials if m] if obj.type=='MESH' else [],
            'bones':[b.name for b in obj.data.bones] if obj.type=='ARMATURE' else [],
            'localTransform':{
                'location':[float(v) for v in obj.location],
                'rotationEuler':[float(v) for v in obj.rotation_euler],
                'scale':[float(v) for v in obj.scale]
            }
        })
    return {'blender_version':bpy.app.version_string,'fps':bpy.context.scene.render.fps,
        'frame_start':bpy.context.scene.frame_start,
        'frame_end':bpy.context.scene.frame_end,
        'objects':sorted(objects,key=lambda x:x['name']),
        'actions':sorted(a.name for a in bpy.data.actions),
        'armature_animation':any(o.type=='ARMATURE' and o.animation_data and o.animation_data.action
                                 for o in bpy.data.objects),
        'render_engine':bpy.context.scene.render.engine}
def artifact_record(path):
    p=Path(path)
    return {'path':p.name,'size_bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
def write_manifest(path,stage,artifacts):
    Path(path).write_text(json.dumps({'schema_version':1,'stage':stage,'scene':inspect_scene(),'artifacts':[artifact_record(p) for p in artifacts]},indent=2,ensure_ascii=False)+'\n')
