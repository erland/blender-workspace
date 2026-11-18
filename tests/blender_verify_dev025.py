"""Verify applied nontrivial Blender modifiers survive new revisions and GLB export."""
import sys,json,struct
from pathlib import Path
import bpy
if '--' not in sys.argv:raise SystemExit('Missing artifact directories')
first,second=map(Path,sys.argv[sys.argv.index('--')+1:])
bpy.ops.wm.open_mainfile(filepath=str(first/'scene.blend'),load_ui=False)
before={x.name:(len(x.data.vertices),len(x.data.polygons),x['bw_object_id'])
        for x in bpy.data.objects if x.type=='MESH'}
bpy.ops.wm.open_mainfile(filepath=str(second/'scene.blend'),load_ui=False)
after={x.name:(len(x.data.vertices),len(x.data.polygons),x['bw_object_id'])
       for x in bpy.data.objects if x.type=='MESH'}
for name in ('Beveled','Smoothed','Cut Body','Cutter'):
    assert name in after
    assert before[name][2]==after[name][2], 'Stable object identity changed'
assert after['Beveled'][1]>before['Beveled'][1], 'Bevel did not produce polygons'
assert after['Smoothed'][1]>before['Smoothed'][1], 'Subdivision did not produce polygons'
assert after['Cut Body'][1]!=before['Cut Body'][1], 'Boolean did not change topology'
assert not bpy.data.objects['Cut Body'].modifiers[:], 'Modifier must be applied'
data=(second/'scene.glb').read_bytes()
assert data[:4]==b'glTF'
n,kind=struct.unpack_from('<I4s',data,12)
assert kind==b'JSON'
gltf=json.loads(data[20:20+n])
nodes={x['name']:x for x in gltf['nodes']}
for name in ('Beveled','Smoothed','Cut Body'):
    node=nodes[name]
    assert node.get('extras',{}).get('bw_object_id')==after[name][2]
    assert gltf['meshes'][node['mesh']]['primitives']
print('BW_DEV025_MODIFIERS PASS')
