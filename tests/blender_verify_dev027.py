"""Check independent Blender PBR material and glTF metallic/roughness/alpha/emission."""
import sys,json,struct
from pathlib import Path
import bpy
if '--' not in sys.argv:raise SystemExit('Missing artifact directories')
source,edited=map(Path,sys.argv[sys.argv.index('--')+1:])
bpy.ops.wm.open_mainfile(filepath=str(source/'scene.blend'),load_ui=False)
id_before=bpy.data.objects['PBR Target']['bw_object_id']
bpy.ops.wm.open_mainfile(filepath=str(edited/'scene.blend'),load_ui=False)
target=bpy.data.objects['PBR Target']
other=bpy.data.objects['Untouched']
assert target['bw_object_id']==id_before
assert target.active_material is not None
assert target.active_material is not other.active_material
bsdf=target.active_material.node_tree.nodes.get('Principled BSDF')
assert abs(bsdf.inputs['Metallic'].default_value-0.8)<1e-6
assert abs(bsdf.inputs['Roughness'].default_value-0.2)<1e-6
assert abs(bsdf.inputs['Alpha'].default_value-0.55)<1e-6
assert abs(bsdf.inputs['Emission Strength'].default_value-0.4)<1e-6
raw=(edited/'scene.glb').read_bytes()
assert raw[:4]==b'glTF'
size,kind=struct.unpack_from('<I4s',raw,12)
assert kind==b'JSON'
gltf=json.loads(raw[20:20+size])
nodes={n['name']:n for n in gltf['nodes']}
node=nodes['PBR Target']
assert node['extras']['bw_object_id']==id_before
mesh=gltf['meshes'][node['mesh']]
material=gltf['materials'][mesh['primitives'][0]['material']]
pbr=material['pbrMetallicRoughness']
assert abs(pbr['metallicFactor']-0.8)<1e-4,material
assert abs(pbr['roughnessFactor']-0.2)<1e-4,material
assert abs(pbr['baseColorFactor'][3]-0.55)<1e-4,material
assert material.get('alphaMode')=='BLEND',material
assert material.get('emissiveFactor',[0,0,0])[0]>0,material
assert gltf['meshes'][nodes['Untouched']['mesh']]['primitives']
print('BW_DEV027_PBR PASS')
