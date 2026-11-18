"""Create or edit arbitrary Blender scenes using validated, fixed operations.

The caller supplies data-only JSON. No dynamic Python, file paths or commands.
"""
import json
import sys
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from blender_workspace_poc.scene_operation_validation import validate_operation
from blender_workspace_poc.common import ensure_output,save_scene,export_glb,write_manifest

def apply_operation(operation):
    kind=operation['kind'];name=operation['name']
    existing=bpy.data.objects.get(name)
    if kind=='add_primitive':
        if existing is not None:raise ValueError('Object name already exists')
        primitives={
            'cube':bpy.ops.mesh.primitive_cube_add,
            'sphere':bpy.ops.mesh.primitive_uv_sphere_add,
            'cylinder':bpy.ops.mesh.primitive_cylinder_add,
            'cone':bpy.ops.mesh.primitive_cone_add,
            'torus':bpy.ops.mesh.primitive_torus_add
        }
        primitives[operation['primitive']]()
        obj=bpy.context.object
        obj.name=name
        if 'location' in operation:obj.location=tuple(operation['location'])
        if 'scale' in operation:obj.scale=tuple(operation['scale'])
        if 'color' in operation:
            mat=bpy.data.materials.new('Material_'+name)
            mat.use_nodes=True
            obj.data.materials.append(mat)
        else:return
    else:
        if existing is None:raise ValueError('Object not found')
        obj=existing
        if kind=='delete_object':
            bpy.data.objects.remove(obj,do_unlink=True)
            return
        if obj.type!='MESH':raise ValueError('Transforms and color require mesh objects')
        if kind=='set_transform':
            if 'location' in operation:obj.location=tuple(operation['location'])
            if 'scale' in operation:obj.scale=tuple(operation['scale'])
            if 'rotation' in operation:obj.rotation_euler=tuple(operation['rotation'])
            return
        if obj.active_material is None:
            mat=bpy.data.materials.new('Material_'+name)
            mat.use_nodes=True
            obj.data.materials.append(mat)
        else:
            mat=obj.active_material.copy()
            obj.active_material=mat
    rgba=tuple(operation['color'])+(1.0,)
    mat.diffuse_color=rgba
    if mat.use_nodes:
        bsdf=mat.node_tree.nodes.get('Principled BSDF')
        if bsdf:bsdf.inputs['Base Color'].default_value=rgba

def main():
    if '--' not in sys.argv:raise SystemExit('Missing fixed operation parameters')
    args=sys.argv[sys.argv.index('--')+1:]
    if len(args)!=3:raise SystemExit('Expected INPUT_OR_NEW OPERATION_JSON REVISION')
    source,operation_file,revision=args
    revision=int(revision)
    if not 1<=revision<=99999999:raise ValueError('Invalid revision')
    op=validate_operation(json.loads(Path(operation_file).read_text('utf8')))
    if source=='NEW':
        if revision!=1 or op['kind']!='add_primitive':
            raise ValueError('New scene requires initial primitive')
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
    else:
        if revision<2:raise ValueError('Existing scene requires later revision')
        bpy.ops.wm.open_mainfile(filepath=source,load_ui=False)
    apply_operation(op)
    out=ensure_output()
    blend=out/'scene.blend';glb=out/'scene.glb'
    save_scene(blend)
    export_glb(glb)
    write_manifest(out/'scene.json','generic_operation',[blend,glb])
    print('BW_SCENE_OPERATION PASS')
if __name__=='__main__':main()
