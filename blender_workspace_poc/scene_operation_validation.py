"""Strict, standalone validation of bounded data-only Blender operations."""
import math
import re
KINDS=('add_primitive','set_transform','set_color','delete_object')
PRIMITIVES=('cube','sphere','cylinder','cone','torus')
def _vector(value,low,high):
    return (isinstance(value,list) and len(value)==3 and
        all(type(x) in (float,int) and math.isfinite(x) and low<=x<=high for x in value))
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
             'set_transform':{'kind','name','location','scale','rotation'},
             'set_color':{'kind','name','color'},
             'delete_object':{'kind','name'}}[kind]
    if set(value)-allowed:raise ValueError('Unrecognized operation field')
    name=value.get('name')
    if not isinstance(name,str) or not 1<=len(name.strip())<=100 or re.search(r'[\x00-\x1f/\\]',name):
        raise ValueError('Invalid object name')
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
