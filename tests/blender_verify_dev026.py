"""Real Blender geometry and GLB regression for DEV-026."""
import sys,json,struct
from pathlib import Path
import bpy
if '--' not in sys.argv:raise SystemExit('Missing artifact directories')
a,b=map(Path,sys.argv[sys.argv.index('--')+1:])
def read_blend(folder):
    bpy.ops.wm.open_mainfile(filepath=str(folder/'scene.blend'),load_ui=False)
    return {o.name:(len(o.data.vertices),len(o.data.polygons),o['bw_object_id'],
                    tuple(o.matrix_world.translation))
            for o in bpy.data.objects if o.type=='MESH'}
before=read_blend(a)
after=read_blend(b)
for name in ('Extruded','Mirrored','Repeated'):
    assert before[name][2]==after[name][2], 'Object identity changed'
    assert after[name][1]>before[name][1],(name,before[name],after[name])
    assert before[name][3]==after[name][3], 'Object moved'
data=(b/'scene.glb').read_bytes()
assert data[:4]==b'glTF'
n,kind=struct.unpack_from('<I4s',data,12)
assert kind==b'JSON'
gltf=json.loads(data[20:20+n])
nodes={node['name']:node for node in gltf['nodes']}
for name in ('Extruded','Mirrored','Repeated'):
    node=nodes[name]
    assert node['extras']['bw_object_id']==after[name][2]
    assert gltf['meshes'][node['mesh']]['primitives']
print('BW_DEV026_EXTRUDE_MIRROR_ARRAY PASS')
