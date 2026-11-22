"""Trusted, fixed-path BLEND scene imports for multi-model composition.

Only the controller can populate the manifest and source files. The original
BLEND sources are never opened in write mode. User bpy code runs afterwards.
"""
from pathlib import Path
import json
import bpy
from blender_workspace_poc.object_identity import assign_new_object_id

ROOT=Path('/workspace/out')
SOURCE_DIR=ROOT
MANIFEST=ROOT/'asset-sources.json'

def compose_sources():
    if not MANIFEST.is_file():
        return []
    spec=json.loads(MANIFEST.read_text(encoding='utf8'))
    if not isinstance(spec,list) or len(spec)>4:
        raise ValueError('Invalid asset source manifest')
    provenance=[]
    for index,entry in enumerate(spec):
        if not isinstance(entry,dict) or set(entry)!={'index','offset','format'}:
            raise ValueError('Invalid source specification')
        if entry['index']!=index:
            raise ValueError('Nonsequential asset index')
        offset=entry['offset']
        if (not isinstance(offset,list) or len(offset)!=3 or
                any(type(v) not in (int,float) or not -100000<=v<=100000 for v in offset)):
            raise ValueError('Invalid source offset')
        fmt=entry['format']
        if fmt not in ('blend','glb'):
            raise ValueError('Unsupported model format')
        filename=SOURCE_DIR/('source-%02d.%s' % (index,fmt))
        if not filename.is_file() or filename.is_symlink():
            raise ValueError('Missing staged model')
        # Link object datablocks from the immutable source, not the source
        # scene's cameras, lights or world. Meshes, armatures, actions and
        # materials are pulled by Blender as referenced datablocks.
        if fmt=='blend':
            with bpy.data.libraries.load(str(filename),link=False) as (src,dst):
                dst.objects=list(src.objects)
            objects=[obj for obj in dst.objects if obj is not None and
                     obj.type not in {'CAMERA','LIGHT','SPEAKER'}]
        else:
            before=set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=str(filename))
            objects=[obj for obj in bpy.data.objects if obj not in before
                     and obj.type not in {'CAMERA','LIGHT','SPEAKER'}]
            # GLB import links objects to the active scene by default.
            # Move them to the isolated source collection below.
        if not objects:
            raise ValueError('Source contains no importable objects')
        group=bpy.data.collections.new('Imported model %02d' % (index+1))
        bpy.context.scene.collection.children.link(group)
        imported=set(objects)
        for obj in objects:
            if fmt=='glb':
                for existing in list(obj.users_collection):
                    existing.objects.unlink(obj)
            group.objects.link(obj)
            assign_new_object_id(obj)
        # Move only independent roots; children retain their local parent
        # transforms so armatures and constraints retain relative placement.
        from mathutils import Vector
        delta=Vector(offset)
        for obj in objects:
            if obj.parent not in imported:
                obj.location += delta
        group['bw_imported_source_index']=index
        group['bw_imported_object_count']=len(objects)
        provenance.append({'sourceIndex':index,'objectsImported':len(objects)})
    return provenance
