"""Trusted-controller structural checks on sandbox-generated files.

No Blender execution or loading the untrusted .blend outside the Sandbox.
Structural validation is a *necessary*, not sufficient, safety boundary:
the file must still only be opened in a restricted worker or safe viewer.
"""
import hashlib
import json
from pathlib import Path
import struct
from uuid import UUID

MAX_MODEL_BYTES=128*1024*1024
MAX_REPORT_BYTES=2*1024*1024

def _file(folder,name,max_bytes):
    file=Path(folder)/name
    if file.is_symlink() or not file.is_file() or not 0<file.stat().st_size<=max_bytes:
        raise ValueError('Missing, oversized or irregular sandbox artifact: '+name)
    return file.read_bytes()

def validate_python_outputs(folder):
    blend=_file(folder,'scene.blend',MAX_MODEL_BYTES)
    glb=_file(folder,'scene.glb',MAX_MODEL_BYTES)
    raw_report=_file(folder,'scene.json',MAX_REPORT_BYTES)
    if not blend.startswith(b'BLENDER') or len(blend)<12:
        raise ValueError('Sandbox returned invalid BLEND header')
    if len(glb)<20 or glb[:4]!=b'glTF':
        raise ValueError('Sandbox returned invalid GLB header')
    version,total=struct.unpack_from('<II',glb,4)
    if version!=2 or total!=len(glb):
        raise ValueError('Sandbox returned invalid GLB v2 length')
    length,chunk=struct.unpack_from('<I4s',glb,12)
    if chunk!=b'JSON' or length==0 or length%4 or 20+length>len(glb):
        raise ValueError('Sandbox returned invalid GLB JSON chunk')
    document=json.loads(glb[20:20+length].decode('utf8'))
    if not isinstance(document,dict) or document.get('asset',{}).get('version')!='2.0':
        raise ValueError('Sandbox returned invalid glTF JSON')
    if not isinstance(document.get('nodes'),list) or not document['nodes']:
        raise ValueError('Exported GLB has no scene nodes')
    if not isinstance(document.get('meshes'),list) or not document['meshes']:
        raise ValueError('Exported GLB has no visible meshes')
    for collection in ('buffers','images'):
        for item in document.get(collection,[]):
            if not isinstance(item,dict) or 'uri' in item:
                raise ValueError('GLB cannot reference external assets')
    report=json.loads(raw_report.decode('utf8'))
    if not isinstance(report,dict) or report.get('schema_version')!=1 or report.get('stage')!='sandbox_python':
        raise ValueError('Sandbox report has invalid provenance')
    scene=report.get('scene')
    if not isinstance(scene,dict) or not isinstance(scene.get('objects'),list) or not 1<=len(scene['objects'])<=512:
        raise ValueError('Sandbox report has invalid objects')
    seen=set()
    for obj in scene['objects']:
        if not isinstance(obj,dict) or not isinstance(obj.get('name'),str) or len(obj['name'])>512:
            raise ValueError('Invalid scene object name')
        identifier=obj.get('objectId')
        try:
            assert str(UUID(identifier,version=4))==identifier
        except (ValueError,TypeError,AssertionError,AttributeError):
            raise ValueError('Invalid scene object identifier') from None
        if identifier in seen:
            raise ValueError('Duplicate scene object identity')
        seen.add(identifier)
    artifacts=report.get('artifacts')
    if not isinstance(artifacts,list) or len(artifacts)!=2:
        raise ValueError('Sandbox report must list both model files')
    checks={'scene.blend':blend,'scene.glb':glb}
    if {item.get('path') for item in artifacts if isinstance(item,dict)}!=set(checks):
        raise ValueError('Unexpected sandbox artifact list')
    for item in artifacts:
        payload=checks[item['path']]
        if item.get('size_bytes')!=len(payload) or item.get('sha256')!=hashlib.sha256(payload).hexdigest():
            raise ValueError('Sandbox artifact checksum mismatch')
    return {'object_count':len(scene['objects']),'node_count':len(document['nodes']),
            'mesh_count':len(document['meshes'])}
