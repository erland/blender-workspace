"""Real Blender regression: source rigs/materials + two model origins."""
from pathlib import Path
import json,sys
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from blender_workspace_poc.compose_sources import compose_sources
from blender_workspace_poc.object_identity import ensure_object_ids,PROPERTY

root=Path('/workspace/out')
root.mkdir(parents=True,exist_ok=True)

def make(name,location,color,path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj=bpy.context.object
    obj.name=name
    mat=bpy.data.materials.new(name+' skin')
    mat.use_nodes=True
    mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*color,1)
    obj.data.materials.append(mat)
    bpy.ops.object.armature_add()
    bone=bpy.context.object
    bone.name=name+' rig'
    obj.parent=bone
    ensure_object_ids(bpy.data.objects)
    bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=False)

make('Rex',(1,0,0),(.1,.4,.05),root/'source-00.blend')
make('Cat',(2,0,0),(.6,.2,.1),root/'source-01.blend')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_uv_sphere_add()
bpy.context.object.name='Existing terrain'
bpy.context.object[PROPERTY]='77777777-7777-4777-8777-777777777777'
(root/'asset-sources.json').write_text(json.dumps([
 {'index':0,'offset':[-4,0,0]},
 {'index':1,'offset':[4,0,0]}
]))
result=compose_sources()
assert len(result)==2,result
assert result[0]['objectsImported']==2,result
assert result[1]['objectsImported']==2,result
assert {x.name for x in bpy.data.objects}=={
 'Rex','Rex rig','Cat','Cat rig','Existing terrain'}
assert abs(bpy.data.objects['Rex rig'].location.x+4)<1e-5
assert abs(bpy.data.objects['Cat rig'].location.x-4)<1e-5
assert bpy.data.objects['Rex'].parent==bpy.data.objects['Rex rig']
assert bpy.data.objects['Cat'].parent==bpy.data.objects['Cat rig']
assert bpy.data.objects['Rex'].data.materials[0].name=='Rex skin'
assert bpy.data.objects['Cat'].data.materials[0].name=='Cat skin'
ensure_object_ids(bpy.data.objects)
ids=[obj[PROPERTY] for obj in bpy.data.objects]
assert len(ids)==len(set(ids))
assert len(bpy.context.scene.collection.children)>=2
print('BW_DEV040_COMPOSITION PASS',flush=True)
