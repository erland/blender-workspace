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

def _validate_python_outputs(folder):
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

# Only these literal validation outcomes can cross the Modal/controller boundary.
# Never export exception text, model names, paths or arbitrary JSON values.
VALIDATION_REASONS = {
    'Sandbox returned invalid BLEND header': 'blend_header_invalid',
    'Sandbox returned invalid GLB header': 'glb_header_invalid',
    'Sandbox returned invalid GLB v2 length': 'glb_length_invalid',
    'Sandbox returned invalid GLB JSON chunk': 'glb_json_chunk_invalid',
    'Sandbox returned invalid glTF JSON': 'gltf_document_invalid',
    'Exported GLB has no scene nodes': 'glb_nodes_missing',
    'Exported GLB has no visible meshes': 'glb_meshes_missing',
    'GLB cannot reference external assets': 'glb_external_assets',
    'Sandbox report has invalid provenance': 'report_provenance_invalid',
    'Sandbox report has invalid objects': 'report_objects_invalid',
    'Invalid scene object name': 'object_name_invalid',
    'Invalid scene object identifier': 'object_id_invalid',
    'Duplicate scene object identity': 'object_id_duplicate',
    'Sandbox report must list both model files': 'report_artifact_list_invalid',
    'Unexpected sandbox artifact list': 'report_artifact_list_invalid',
    'Sandbox artifact checksum mismatch': 'artifact_checksum_mismatch',
}
class ArtifactValidationError(ValueError):
    def __init__(self, reason):
        self.reason = reason
        super().__init__('artifact_invalid:' + reason)

def validate_python_outputs(folder):
    try:
        return _validate_python_outputs(folder)
    except ValueError as exc:
        message = str(exc)
        if message.startswith('Missing, oversized or irregular sandbox artifact: '):
            name = message.removeprefix('Missing, oversized or irregular sandbox artifact: ')
            reason = {
                'scene.blend': 'blend_file_invalid',
                'scene.glb': 'glb_file_invalid',
                'scene.json': 'report_file_invalid',
            }.get(name, 'artifact_unclassified')
        else:
            reason = VALIDATION_REASONS.get(message, 'artifact_unclassified')
        raise ArtifactValidationError(reason) from None
    except (OSError, UnicodeError, TypeError, KeyError, IndexError):
        raise ArtifactValidationError('artifact_unclassified') from None
