"""Real headless Blender verification of DEV-030 metrics and diagnostics."""
import json
import os
import tempfile
from pathlib import Path
import bpy

from blender_workspace_poc.common import inspect_scene, write_manifest

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add(size=2,location=(2,0,0))
bpy.context.object.name='Closed Cube'
bpy.ops.mesh.primitive_plane_add(size=2,location=(-2,0,0))
bpy.context.object.name='Open Plane'
bpy.context.view_layer.update()
scene=inspect_scene()
objects={o['name']:o for o in scene['objects']}
cube=objects['Closed Cube']['geometry']
plane=objects['Open Plane']['geometry']
assert cube['vertexCount']==8 and cube['edgeCount']==12 and cube['faceCount']==6, cube
assert cube['triangleCount']==12
assert cube['qualityChecks']=={
    'boundaryEdges':0,'nonManifoldEdges':0,'looseEdges':0,
    'isolatedVertices':0,'degenerateFaces':0},cube
assert cube['warnings']==[]
assert cube['worldBounds']['min']==[1.0,-1.0,-1.0],cube
assert cube['worldBounds']['max']==[3.0,1.0,1.0],cube
assert plane['vertexCount']==4 and plane['faceCount']==1,plane
assert plane['qualityChecks']['boundaryEdges']==4,plane
assert plane['warnings']==[{'code':'open_boundaries','count':4}],plane
assert len(objects['Closed Cube']['objectId'])==36
assert len(objects['Open Plane']['objectId'])==36
# Confirm real immutable report writing path includes geometry for all meshes.
with tempfile.TemporaryDirectory() as folder:
    p=Path(folder)/'scene.json'
    dummy=Path(folder)/'scene.glb'
    dummy.write_bytes(b'placeholder')
    write_manifest(p,'geometry_smoke',[dummy])
    result=json.loads(p.read_text())
    reports={o['name']:o for o in result['scene']['objects']}
    assert reports['Closed Cube']['geometry']['vertexCount']==8
    assert reports['Open Plane']['geometry']['qualityChecks']['boundaryEdges']==4
print('BW_DEV030_GEOMETRY PASS',flush=True)
