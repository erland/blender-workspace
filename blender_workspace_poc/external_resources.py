"""Externalize immutable image textures after Blender's normal pack pass.

The native scene stores paths relative to scene.blend; its image bytes live in
the revision's content-addressed resource manifest. This module is called
*after* user Python but *before* saving scene.blend and GLB.
"""
import hashlib
from pathlib import Path
import bpy

ROOT=Path('/workspace/out')
MAX_IMAGE=256*1024*1024

def externalize_image_textures():
    folder=ROOT/'resources'
    references={}
    for image in bpy.data.images:
        if image.source!='FILE':
            # Generated textures have no external byte dependency. Multitile
            # sources stay packed until they can be represented safely.
            continue
        packed=image.packed_file
        if packed is None:
            # A FILE image without packed bytes is a missing prerequisite:
            # never publish a scene that will render differently next time.
            raise ValueError('File texture is not packed')
        data=bytes(packed.data)
        if not 20<=len(data)<=MAX_IMAGE:
            raise ValueError('Unsupported packed image size')
        if data.startswith(bytes.fromhex('89504e470d0a1a0a')):
            ext='png'
        elif data.startswith(bytes.fromhex('ffd8ff')):
            ext='jpg'
        else:
            # Other packed formats are intentionally kept inside BLEND for
            # now, rather than corrupting them with a fabricated extension.
            continue
        sha=hashlib.sha256(data).hexdigest()
        name='resources/'+sha+'.'+ext
        destination=folder/(sha+'.'+ext)
        folder.mkdir(parents=True,exist_ok=True)
        if destination.is_file():
            if destination.read_bytes()!=data:
                raise ValueError('Conflicting extracted image bytes')
        else:
            destination.write_bytes(data)
        # Removing packed bytes is crucial: storing an additional path while
        # leaving the packed file would duplicate the image in every revision.
        image.unpack(method='REMOVE')
        image.filepath='//'+name
        # Do not reload before scene.blend exists: // paths are relative
        # to the not-yet-saved scene. The caller saves immediately after.
        if image.packed_file is not None:
            raise ValueError('Image remained packed after externalization')
        references[name]={'name':name,'sha256':sha,'sizeBytes':len(data)}
    return [references[k] for k in sorted(references)]
