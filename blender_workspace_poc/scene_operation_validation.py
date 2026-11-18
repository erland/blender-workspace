"""Strict, standalone validation of bounded data-only Blender operations."""
import math
import re
from blender_workspace_poc.object_identity import valid_object_id
from blender_workspace_poc.glb_import_validation import decode_embedded_glb
KINDS=('add_primitive','set_transform','set_color','delete_object','duplicate_object','rename_object','set_parent','add_mesh','bevel_mesh','subdivide_mesh','boolean_mesh','extrude_face','mirror_mesh','array_mesh','set_pbr_material','import_glb')
PRIMITIVES=('cube','sphere','cylinder','cone','torus')
def _vector(value,low,high):
    return (isinstance(value,list) and len(value)==3 and
        all(type(x) in (float,int) and math.isfinite(x) and low<=x<=high for x in value))
def _valid_name(value):
    return isinstance(value,str) and 1<=len(value.strip())<=100 and re.search(r'[\x00-\x1f/\\]',value) is None

def validate_operation(value):
    if isinstance(value,dict) and value.get('kind')=='batch':
        if set(value)!={'kind','operations'}:
            raise ValueError('Invalid batch fields')
        items=value['operations']
        if not isinstance(items,list) or not 1<=len(items)<=20:
            raise ValueError('Batch must contain 1 to 20 operations')
        for item in items:
            if not isinstance(item,dict) or item.get('kind')=='batch':
                raise ValueError('Nested batch is forbidden')
            validate_operation(item)
        return value
    if not isinstance(value,dict) or value.get('kind') not in KINDS:
        raise ValueError('Invalid operation kind')
    kind=value['kind']
    allowed={'add_primitive':{'kind','name','primitive','location','scale','color'},
             'add_mesh':{'kind','name','vertices','faces','location','scale','rotation','color'},
             'import_glb':{'kind','name','glbBase64'},
             'set_transform':{'kind','name','objectId','location','scale','rotation'},
             'set_color':{'kind','name','objectId','color'},
             'set_pbr_material':{'kind','name','objectId','baseColor','metallic','roughness','opacity','emissionColor','emissionStrength'},
             'delete_object':{'kind','name','objectId'},
             'rename_object':{'kind','name','objectId','newName'},
             'set_parent':{'kind','name','objectId','parentId'},
             'bevel_mesh':{'kind','name','objectId','width','segments'},
             'subdivide_mesh':{'kind','name','objectId','levels'},
             'boolean_mesh':{'kind','name','objectId','operandId','operation'},
             'extrude_face':{'kind','name','objectId','faceIndex','offset'},
             'mirror_mesh':{'kind','name','objectId','axis'},
             'array_mesh':{'kind','name','objectId','count','offset'},
             'duplicate_object':{'kind','name','source','sourceId','location','scale','rotation'}}[kind]
    if set(value)-allowed:raise ValueError('Unrecognized operation field')
    name=value.get('name')
    object_id=value.get('objectId')
    if kind in ('add_primitive','duplicate_object','add_mesh','import_glb'):
        if not _valid_name(name):raise ValueError('Invalid new object name')
    else:
        if (name is None)==(object_id is None):
            raise ValueError('Exactly one object selector required')
        if name is not None and not _valid_name(name):
            raise ValueError('Invalid object name')
        if object_id is not None and not valid_object_id(object_id):
            raise ValueError('Invalid object ID')
    if kind=='rename_object':
        new_name=value.get('newName')
        if not _valid_name(new_name):raise ValueError('Invalid new object name')
        if name is not None and new_name==name:raise ValueError('Object name must change')
    if kind=='duplicate_object':
        source=value.get('source')
        source_id=value.get('sourceId')
        if (source is None)==(source_id is None):
            raise ValueError('Exactly one source selector required')
        if source is not None and not _valid_name(source):
            raise ValueError('Invalid source object name')
        if source_id is not None and not valid_object_id(source_id):
            raise ValueError('Invalid source object ID')
        if source==name:raise ValueError('Duplicate target must differ')
    if kind=='set_parent':
        if 'parentId' not in value:raise ValueError('Parent ID required')
        parent_id=value['parentId']
        if parent_id is not None and not valid_object_id(parent_id):
            raise ValueError('Invalid parent object ID')
        if object_id is not None and object_id==parent_id:
            raise ValueError('Self parenting forbidden')
    if kind=='set_pbr_material':
        if not _vector(value.get('baseColor'),0,1) or not _vector(value.get('emissionColor'),0,1):
            raise ValueError('PBR colors must be finite RGB components between 0 and 1')
        for key in ('metallic','roughness','opacity','emissionStrength'):
            v=value.get(key)
            if type(v) not in (float,int) or not math.isfinite(v) or not 0<=v<=1:
                raise ValueError('Invalid PBR '+key)
    if kind=='bevel_mesh':
        width=value.get('width')
        segments=value.get('segments')
        if type(width) not in (int,float) or not math.isfinite(width) or not 0.001<=width<=2:
            raise ValueError('Bevel width must be finite and between 0.001 and 2')
        if type(segments) is not int or not 1<=segments<=3:
            raise ValueError('Bevel segments must be 1 to 3')
    if kind=='subdivide_mesh':
        levels=value.get('levels')
        if type(levels) is not int or not 1<=levels<=2:
            raise ValueError('Subdivision levels must be 1 or 2')
    if kind=='boolean_mesh':
        operand_id=value.get('operandId')
        if not valid_object_id(operand_id):raise ValueError('Invalid Boolean operand ID')
        if value.get('operation') not in ('union','difference','intersection'):
            raise ValueError('Invalid Boolean operation')
        if object_id is not None and object_id==operand_id:
            raise ValueError('Boolean target must differ from operand')
    if kind=='extrude_face':
        index=value.get('faceIndex')
        if type(index) is not int or not 0<=index<=39999:
            raise ValueError('Extrusion face index must be 0 to 39999')
    if kind=='mirror_mesh' and value.get('axis') not in ('x','y','z'):
        raise ValueError('Mirror axis must be x, y or z')
    if kind=='array_mesh':
        count=value.get('count')
        if type(count) is not int or not 2<=count<=8:
            raise ValueError('Array count must be 2 to 8')
    if kind in ('extrude_face','array_mesh'):
        offset=value.get('offset')
        if not _vector(offset,-10,10) or not any(n!=0 for n in offset):
            raise ValueError('Offset must be finite, nonzero and within [-10,10]')
    if kind=='import_glb':
        decode_embedded_glb(value.get('glbBase64'))
    if kind=='add_mesh':
        vertices=value.get('vertices')
        faces=value.get('faces')
        if not isinstance(vertices,list) or not 3<=len(vertices)<=1024 or not all(
                _vector(v,-100,100) for v in vertices):
            raise ValueError('Mesh requires 3 to 1024 finite vertices')
        if not isinstance(faces,list) or not 1<=len(faces)<=2048:
            raise ValueError('Mesh requires 1 to 2048 polygon faces')
        total=0
        for face in faces:
            if not isinstance(face,list) or not 3<=len(face)<=8:
                raise ValueError('Face must have 3 to 8 vertices')
            total+=len(face)
            if total>8192:raise ValueError('Too many face indices')
            if any(type(i) is not int or i<0 or i>=len(vertices) for i in face):
                raise ValueError('Face vertex index out of bounds')
            if len(set(face))!=len(face):
                raise ValueError('Repeated face index')
    if kind=='add_primitive' and value.get('primitive') not in PRIMITIVES:
        raise ValueError('Invalid primitive')
    if kind=='set_transform' and not any(k in value for k in ('location','scale','rotation')):
        raise ValueError('Empty transform')
    if kind=='set_color' and 'color' not in value:
        raise ValueError('Missing color')
    for key,low,high in (('location',-100,100),('scale',0.01,100),('rotation',-100,100),('color',0,1)):
        if key in value and not _vector(value[key],low,high):
            raise ValueError('Invalid '+key)
    return value
