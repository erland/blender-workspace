"""Generate a rigged cube-bodied monster and a looping walk animation."""
import math
import time
import bpy
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from blender_workspace_poc.common import FRAME_END,FRAME_RATE,ensure_output,export_glb,save_scene,write_manifest
t0=time.monotonic()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.frame_start=1
scene.frame_end=FRAME_END
scene.render.fps=FRAME_RATE
scene.render.engine='CYCLES'
scene.render.resolution_x=320
scene.render.resolution_y=240
def material(name,rgba):
    m=bpy.data.materials.new(name)
    m.diffuse_color=(*rgba,1.0)
    m.use_nodes=True
    bsdf=m.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value=(*rgba,1)
        bsdf.inputs['Roughness'].default_value=0.7
    return m
body_mat=material('Monster_Green',(0.12,0.67,0.30))
leg_mat=material('Leg_Dark_Green',(0.05,0.38,0.18))
eye_mat=material('Eye_White',(0.94,0.97,1.0))
pupil_mat=material('Pupil_Black',(0.02,0.025,0.035))
bpy.ops.object.armature_add(enter_editmode=True,location=(0,0,0))
rig=bpy.context.object
rig.name='MonsterRig'
rig.data.name='MonsterRigData'
ebs=rig.data.edit_bones
ebs.remove(ebs[0])
def bone(name,head,tail,parent=None):
    b=ebs.new(name)
    b.head=head
    b.tail=tail
    if parent: b.parent=ebs[parent]
    return b
bone('Root',(0,0,0.9),(0,0,1.15))
bone('Torso',(0,0,1.15),(0,0,1.9),'Root')
bone('LeftLeg',(-0.38,0,0.87),(-0.38,0,0.2),'Root')
bone('RightLeg',(0.38,0,0.87),(0.38,0,0.2),'Root')
bpy.ops.object.mode_set(mode='OBJECT')
rig.show_in_front=True
def bind(obj,bone_name):
    group=obj.vertex_groups.new(name=bone_name)
    group.add(list(range(len(obj.data.vertices))),1.0,'REPLACE')
    modifier=obj.modifiers.new('MonsterSkin','ARMATURE')
    modifier.object=rig
    obj.parent=rig
    obj.matrix_parent_inverse=rig.matrix_world.inverted()
def cube(name,loc,scale,mat,bone_name,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    obj=bpy.context.object
    obj.name=name
    obj.dimensions=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod=obj.modifiers.new('SlightlyRounded','BEVEL')
        mod.width=bevel
        mod.segments=2
        bpy.context.view_layer.objects.active=obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bind(obj,bone_name)
    return obj
def sphere(name,loc,radius,mat,bone_name):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=radius,location=loc)
    obj=bpy.context.object
    obj.name=name
    obj.data.materials.append(mat)
    bind(obj,bone_name)
    return obj
cube('Body',(0,0,1.42),(1.35,0.95,1.12),body_mat,'Torso',0.08)
for side,x in [('Left',-0.38),('Right',0.38)]:
    cube(side+'Leg',(x,0,0.46),(0.31,0.34,0.82),leg_mat,side+'Leg',0.055)
    sphere(side+'Eye',(x*0.78,-0.49,1.72),0.20,eye_mat,'Torso')
    sphere(side+'Pupil',(x*0.78,-0.665,1.72),0.083,pupil_mat,'Torso')
for pb in rig.pose.bones:
    pb.rotation_mode='XYZ'
for frame in (1,7,13,19,25,31,37,43,49):
    phase=2*math.pi*(frame-1)/48
    for side,sign in [('Left',1),('Right',-1)]:
        pb=rig.pose.bones[side+'Leg']
        pb.rotation_euler[0]=sign*0.30*math.sin(phase)
        pb.keyframe_insert(data_path='rotation_euler',frame=frame,group='WalkCycle')
    torso=rig.pose.bones['Torso']
    torso.location.z=0.035*(1-math.cos(2*phase))
    torso.keyframe_insert(data_path='location',frame=frame,group='WalkCycle')
if not rig.animation_data or not rig.animation_data.action:
    raise RuntimeError('No armature action created')
rig.animation_data.action.name='WalkCycle'
for mesh in (o for o in bpy.data.objects if o.type=='MESH'):
    assert any(mod.type=='ARMATURE' for mod in mesh.modifiers)
scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active=rig
out=ensure_output()
blend=out/'monster_v1.blend'
glb=out/'monster_v1.glb'
save_scene(blend)
export_glb(glb)
write_manifest(out/'monster_v1.json','created',[blend,glb])
print(f'BW_METRIC stage=create duration_seconds={time.monotonic()-t0:.3f}')
