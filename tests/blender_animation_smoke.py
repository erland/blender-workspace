"""Offline Blender smoke: animated keyframes survive the production GLB exporter."""
import json
import struct
import tempfile
from pathlib import Path

import bpy
from blender_workspace_poc.common import export_glb

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add()
cube=bpy.context.object
cube.name='Animated Test Cube'
cube.location.x=0
cube.keyframe_insert(data_path='location',frame=1)
cube.location.x=2
cube.keyframe_insert(data_path='location',frame=25)
bpy.context.scene.frame_start=1
bpy.context.scene.frame_end=25
bpy.context.scene.render.fps=24
bpy.context.scene.frame_set(1)

with tempfile.TemporaryDirectory() as folder:
    output=Path(folder)/'animated.glb'
    export_glb(output)
    raw=output.read_bytes()
    assert raw[:4]==b'glTF', 'Not a GLB'
    chunk_length,chunk_type=struct.unpack_from('<I4s',raw,12)
    assert chunk_type==b'JSON', 'Missing JSON chunk'
    payload=json.loads(raw[20:20+chunk_length].decode('utf-8'))
    animations=payload.get('animations',[])
    assert animations,'Keyframed Blender model exported without GLB animations'
    assert any(a.get('channels') for a in animations),'No animation channels'
    assert payload.get('nodes'),'No exported scene nodes'
    print('BW_ANIMATED_GLB_EXPORT PASS')
