"""Create or edit arbitrary Blender scenes using validated, fixed operations.

The caller supplies data-only JSON. No dynamic Python, file paths or commands.
"""
import json
import sys
import tempfile
import os
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from blender_workspace_poc.scene_operation_validation import validate_operation
from blender_workspace_poc.object_identity import assign_new_object_id,ensure_object_ids,PROPERTY
from blender_workspace_poc.glb_import_validation import decode_embedded_glb
from blender_workspace_poc.common import ensure_output,save_scene,export_glb,write_manifest
from blender_workspace_poc.material_library import create_library_material,assign_library_material

def find_by_id(object_id):
    matches=[obj for obj in bpy.data.objects if obj.get(PROPERTY)==object_id]
    if len(matches)!=1:
        raise ValueError('Object ID not found or ambiguous')
    return matches[0]

def resolve_target(operation,selector='objectId',name_key='name'):
    if selector in operation:
        return find_by_id(operation[selector])
    obj=bpy.data.objects.get(operation[name_key])
    if obj is None:raise ValueError('Object not found')
    return obj

def set_parent_preserving_world(obj,parent):
    if parent is obj:
        raise ValueError('Cannot parent object to itself')
    cursor=parent
    while cursor is not None:
        if cursor is obj:raise ValueError('Object hierarchy cycle forbidden')
        cursor=cursor.parent
    original=obj.matrix_world.copy()
    obj.parent=parent
    obj.matrix_world=original

def apply_bounded_modifier(obj,modifier):
    """Evaluate only a fixed Blender modifier and reject excessive output.

    No user-defined scripts, filenames, modifier expressions or unbounded levels.
    An invalid result aborts this job before publishing an immutable revision.
    """
    if obj.type!='MESH':raise ValueError('Target must be a mesh')
    if len(obj.data.vertices)>20000 or len(obj.data.polygons)>40000:
        raise ValueError('Mesh exceeds modifier input complexity limit')
    depsgraph=bpy.context.evaluated_depsgraph_get()
    evaluated=obj.evaluated_get(depsgraph)
    evaluated_mesh=evaluated.to_mesh()
    try:
        if evaluated_mesh is None or len(evaluated_mesh.vertices)>100000 or len(evaluated_mesh.polygons)>50000:
            raise ValueError('Modifier output exceeds complexity limit')
    finally:
        if evaluated_mesh is not None:evaluated.to_mesh_clear()
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    applied=bpy.ops.object.modifier_apply(modifier=modifier.name)
    if 'FINISHED' not in applied:raise ValueError('Modifier application failed')

def extrude_bounded_face(obj,face_index,offset):
    """Extrude one polygon in local coordinates, preserving the object's UUID."""
    if obj.type!='MESH':raise ValueError('Extrusion target must be a mesh')
    mesh=obj.data
    if len(mesh.vertices)>20000 or len(mesh.polygons)>40000:
        raise ValueError('Mesh exceeds editing input limit')
    if face_index>=len(mesh.polygons):raise ValueError('Face index not found')
    # Do not modify a mesh shared by other objects. Other references stay intact.
    if mesh.users>1:obj.data=mesh.copy()
    bm=bmesh.new()
    try:
        bm.from_mesh(obj.data)
        bm.faces.ensure_lookup_table()
        face=bm.faces[face_index]
        output=bmesh.ops.extrude_discrete_faces(bm,faces=[face])
        caps=output['faces']
        verts=set(v for cap in caps for v in cap.verts)
        bmesh.ops.translate(bm,verts=list(verts),vec=Vector(offset))
        if len(bm.verts)>100000 or len(bm.faces)>50000:
            raise ValueError('Extrusion output exceeds complexity limit')
        bm.to_mesh(obj.data)
        obj.data.update()
    finally:
        bm.free()

def apply_pbr_material(obj,operation):
    """Assign a GLB-compatible Principled BSDF without editing shared materials."""
    if obj.type!='MESH':raise ValueError('PBR material requires a mesh object')
    if obj.data.users>1:
        obj.data=obj.data.copy()
    mat=bpy.data.materials.new('BW PBR '+obj.name)
    mat.use_nodes=True
    rgba=tuple(operation['baseColor'])+(operation['opacity'],)
    mat.diffuse_color=rgba
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    if bsdf is None:raise ValueError('Blender Principled BSDF unavailable')
    bsdf.inputs['Base Color'].default_value=rgba
    bsdf.inputs['Metallic'].default_value=operation['metallic']
    bsdf.inputs['Roughness'].default_value=operation['roughness']
    bsdf.inputs['Alpha'].default_value=operation['opacity']
    bsdf.inputs['Emission Color'].default_value=tuple(operation['emissionColor'])+(1.0,)
    bsdf.inputs['Emission Strength'].default_value=operation['emissionStrength']
    # Blender 4.2+ glTF exporter recognizes the dithered transparent surface.
    if operation['opacity']<1:
        if hasattr(mat,'surface_render_method'):
            mat.surface_render_method='DITHERED'
        elif hasattr(mat,'blend_method'):
            mat.blend_method='BLEND'
    obj.data.materials.clear()
    obj.data.materials.append(mat)

def import_bounded_glb(operation):
    """Load a self-contained small GLB from a private temporary file.

    The caller controls only validated bytes, never paths or import flags.
    """
    raw=decode_embedded_glb(operation['glbBase64'])
    prior={obj.as_pointer() for obj in bpy.data.objects}
    filename=None
    try:
        with tempfile.NamedTemporaryFile(mode='wb',suffix='.glb',
                                         prefix='.bw-import-',dir=str(ensure_output()),
                                         delete=False) as handle:
            filename=handle.name
            handle.write(raw)
        result=bpy.ops.import_scene.gltf(filepath=filename)
        if 'FINISHED' not in result:
            raise ValueError('Blender GLB import did not finish')
    finally:
        if filename is not None:
            os.unlink(filename)
    imported=[obj for obj in bpy.data.objects if obj.as_pointer() not in prior]
    meshes=[obj for obj in imported if obj.type=='MESH']
    if not meshes or len(imported)>256 or len(meshes)>128:
        raise ValueError('Imported GLB object count outside limits')
    if (sum(len(obj.data.vertices) for obj in meshes)>100000 or
        sum(len(obj.data.polygons) for obj in meshes)>50000):
        raise ValueError('Imported GLB topology exceeds limits')
    prefix=operation['name']
    for obj in imported:
        # External glTF extras must never be trusted as our stable identity.
        assign_new_object_id(obj)
        obj.name=(prefix+'_'+obj.name)[:100]

def apply_operation(operation):
    kind=operation['kind'];name=operation.get('name')
    existing=bpy.data.objects.get(name) if name is not None else None
    if kind=='create_pbr_material':
        create_library_material(operation)
        return
    if kind=='assign_material':
        assign_library_material(resolve_target(operation),operation['materialName'])
        return
    if kind=='import_glb':
        import_bounded_glb(operation)
        return
    if kind=='add_mesh':
        if existing is not None:raise ValueError('Object name already exists')
        mesh=bpy.data.meshes.new('Geometry_'+name)
        obj=None
        try:
            mesh.from_pydata([tuple(v) for v in operation['vertices']],[],
                             [tuple(face) for face in operation['faces']])
            mesh.validate(clean_customdata=False)
            mesh.update()
            obj=bpy.data.objects.new(name,mesh)
            bpy.context.scene.collection.objects.link(obj)
            if 'location' in operation:obj.location=tuple(operation['location'])
            if 'scale' in operation:obj.scale=tuple(operation['scale'])
            if 'rotation' in operation:obj.rotation_euler=tuple(operation['rotation'])
            if 'color' in operation:
                rgba=tuple(operation['color'])+(1.0,)
                mat=bpy.data.materials.new('Material_'+name)
                mat.use_nodes=True
                mat.diffuse_color=rgba
                bsdf=mat.node_tree.nodes.get('Principled BSDF')
                if bsdf:bsdf.inputs['Base Color'].default_value=rgba
                mesh.materials.append(mat)
            return
        except Exception:
            if obj is not None:bpy.data.objects.remove(obj,do_unlink=True)
            if mesh.users==0:bpy.data.meshes.remove(mesh)
            raise
    if kind=='duplicate_object':
        source=resolve_target(operation,'sourceId','source')
        if source is None or source.type!='MESH':
            raise ValueError('Source mesh object not found')
        if existing is not None:raise ValueError('Object name already exists')
        obj=source.copy()
        obj.data=source.data.copy()
        obj.name=name
        assign_new_object_id(obj)
        # Copies remain independently editable, including object transforms
        # and material slots. A fresh name never overwrites an existing object.
        bpy.context.scene.collection.objects.link(obj)
        obj.parent=None
        obj.matrix_parent_inverse.identity()
        if 'location' in operation:obj.location=tuple(operation['location'])
        if 'scale' in operation:obj.scale=tuple(operation['scale'])
        if 'rotation' in operation:obj.rotation_euler=tuple(operation['rotation'])
        return
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
        obj=resolve_target(operation)
        name=obj.name
        if kind=='set_pbr_material':
            apply_pbr_material(obj,operation)
            return
        if kind=='set_parent':
            parent=find_by_id(operation['parentId']) if operation['parentId'] is not None else None
            set_parent_preserving_world(obj,parent)
            return
        if kind=='rename_object':
            if bpy.data.objects.get(operation['newName']) is not None:
                raise ValueError('Object name already exists')
            obj.name=operation['newName']
            return
        if kind=='delete_object':
            bpy.data.objects.remove(obj,do_unlink=True)
            return
        if kind=='extrude_face':
            extrude_bounded_face(obj,operation['faceIndex'],operation['offset'])
            return
        if kind in ('mirror_mesh','array_mesh'):
            if obj.type!='MESH':raise ValueError('Modifier target must be a mesh')
            if kind=='mirror_mesh':
                modifier=obj.modifiers.new('BW Mirror','MIRROR')
                modifier.use_axis=[operation['axis']==key for key in ('x','y','z')]
                modifier.use_clip=False
                modifier.use_mirror_merge=True
            else:
                modifier=obj.modifiers.new('BW Array','ARRAY')
                modifier.count=operation['count']
                modifier.use_relative_offset=False
                modifier.use_constant_offset=True
                modifier.constant_offset_displace=tuple(operation['offset'])
                modifier.use_merge_vertices=False
            apply_bounded_modifier(obj,modifier)
            return
        if kind in ('bevel_mesh','subdivide_mesh','boolean_mesh'):
            if obj.type!='MESH':raise ValueError('Modifier target must be a mesh')
            if len(obj.data.vertices)>20000 or len(obj.data.polygons)>40000:
                raise ValueError('Mesh exceeds modifier input complexity limit')
            if kind=='boolean_mesh':
                operand=find_by_id(operation['operandId'])
                if operand is obj or operand.type!='MESH':
                    raise ValueError('Boolean operand must be a distinct mesh')
                if len(operand.data.vertices)>20000 or len(operand.data.polygons)>40000:
                    raise ValueError('Boolean operand exceeds complexity limit')
                modifier=obj.modifiers.new('BW Boolean','BOOLEAN')
                modifier.operation={'union':'UNION','difference':'DIFFERENCE',
                                    'intersection':'INTERSECT'}[operation['operation']]
                modifier.solver='EXACT'
                modifier.object=operand
            elif kind=='bevel_mesh':
                modifier=obj.modifiers.new('BW Bevel','BEVEL')
                modifier.width=operation['width']
                modifier.segments=operation['segments']
                modifier.limit_method='ANGLE'
            else:
                modifier=obj.modifiers.new('BW Subdivision','SUBSURF')
                modifier.levels=operation['levels']
                modifier.render_levels=operation['levels']
            apply_bounded_modifier(obj,modifier)
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
    actions=op['operations'] if op['kind']=='batch' else [op]
    if source=='NEW':
        if revision!=1 or actions[0]['kind'] not in ('add_primitive','add_mesh','import_glb'):
            raise ValueError('New scene requires initial primitive')
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
    else:
        if revision<2:raise ValueError('Existing scene requires later revision')
        bpy.ops.wm.open_mainfile(filepath=source,load_ui=False,use_scripts=False)
    # Legacy scenes get IDs before ID-addressed operations; batch-created
    # objects receive IDs before subsequent steps in the same batch.
    ensure_object_ids(bpy.data.objects)
    for action in actions:
        apply_operation(action)
        ensure_object_ids(bpy.data.objects)
    out=ensure_output()
    blend=out/'scene.blend';glb=out/'scene.glb'
    save_scene(blend)
    export_glb(glb)
    write_manifest(out/'scene.json','generic_operation',[blend,glb])
    print('BW_SCENE_OPERATION PASS')
if __name__=='__main__':main()
