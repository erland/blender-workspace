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

MAX_BLEND_BYTES=256*1024*1024
MAX_GLB_BYTES=128*1024*1024
MAX_REPORT_BYTES=16*1024*1024

MAX_INLINE_PNG_BYTES=16*1024*1024

def validate_png_preview(path):
    """Validate a 512x512 8-bit RGB/RGBA PNG; bounded and checksum-verifiable."""
    p=Path(path)
    if p.is_symlink() or not p.is_file() or not 33<=p.stat().st_size<=MAX_INLINE_PNG_BYTES:
        raise ValueError('Invalid inline PNG size')
    with p.open('rb') as stream:
        header=stream.read(33)
    if header[:8]!=b'\x89PNG\r\n\x1a\n' or header[12:16]!=b'IHDR':
        raise ValueError('Invalid inline PNG signature')
    width,height=struct.unpack_from('>II',header,16)
    if (width,height)!=(512,512) or header[24]!=8 or header[25] not in (2,6):
        raise ValueError('Invalid inline PNG dimensions')
    return True

def _file(folder,name,max_bytes,header_only=False):
    file=Path(folder)/name
    if file.is_symlink() or not file.is_file() or not 0<file.stat().st_size<=max_bytes:
        raise ValueError('Missing, oversized or irregular sandbox artifact: '+name)
    if header_only:
        with file.open('rb') as source:
            return source.read(12)
    return file.read_bytes()


def _digest(file):
    hasher=hashlib.sha256()
    with Path(file).open('rb') as source:
        for chunk in iter(lambda: source.read(1024*1024), b''):
            hasher.update(chunk)
    return hasher.hexdigest()

def _validate_python_outputs(folder):
    blend=_file(folder,'scene.blend',MAX_BLEND_BYTES,header_only=True)
    glb=None
    raw_report=_file(folder,'scene.json',MAX_REPORT_BYTES)
    if not blend.startswith(b'BLENDER') or len(blend)<12:
        raise ValueError('Sandbox returned invalid BLEND header')
    node_count=0
    mesh_count=0
    if (Path(folder)/'scene.glb').exists():
        glb=_file(folder,'scene.glb',MAX_GLB_BYTES)
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
        if not isinstance(document.get('meshes',[]),list):
            raise ValueError('Exported GLB has invalid mesh list')
        for collection in ('buffers','images'):
            for item in document.get(collection,[]):
                if not isinstance(item,dict) or 'uri' in item:
                    raise ValueError('GLB cannot reference external assets')
        node_count=len(document['nodes'])
        mesh_count=len(document.get('meshes',[]))
    report=json.loads(raw_report.decode('utf8'))
    if not isinstance(report,dict) or report.get('schema_version')!=1 or report.get('stage')!='sandbox_python':
        raise ValueError('Sandbox report has invalid provenance')
    scene=report.get('scene')
    if not isinstance(scene,dict) or not isinstance(scene.get('objects'),list) or len(scene['objects'])<1:
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
    if not isinstance(artifacts,list) or len(artifacts) not in (1,2,3):
        raise ValueError('Sandbox report must list both model files')
    checks={'scene.blend':blend}
    if glb is not None:
        checks['scene.glb']=glb
    png_file=Path(folder)/'scene.png'
    if png_file.exists():
        validate_png_preview(png_file)
        checks['scene.png']=None
    if {item.get('path') for item in artifacts if isinstance(item,dict)}!=set(checks):
        raise ValueError('Unexpected sandbox artifact list')
    for item in artifacts:
        payload=checks[item['path']]
        if item.get('size_bytes')!=Path(folder,item['path']).stat().st_size or item.get('sha256')!=_digest(Path(folder,item['path'])):
            raise ValueError('Sandbox artifact checksum mismatch')
    inline=report.get('inlineRender')
    if inline is not None:
        if not isinstance(inline,dict) or inline.get('format')!='png' or inline.get('status') not in ('available','unavailable'):
            raise ValueError('Invalid inline render metadata')
        if (inline['status']=='available') != png_file.exists():
            raise ValueError('Inline render file mismatch')
        if inline['status']=='available' and (inline.get('width'),inline.get('height'),inline.get('samples'),inline.get('engine'))!=(512,512,16,'CYCLES'):
            raise ValueError('Invalid inline render settings')
    elif png_file.exists():
        raise ValueError('Inline render file mismatch')
    preview=report.get('preview')
    if preview is not None:
        if not isinstance(preview,dict) or preview.get('format')!='glb':
            raise ValueError('Invalid preview metadata')
        if glb is None:
            if preview.get('status')!='unavailable' or preview.get('reason')!='export_failed':
                raise ValueError('Invalid preview metadata')
        elif preview.get('status')!='available' or preview.get('fidelity')!='unverified':
            raise ValueError('Invalid preview metadata')
    return {'object_count':len(scene['objects']),'node_count':node_count,
            'mesh_count':mesh_count,'glb_available':glb is not None}

# Only these literal validation outcomes can cross the Modal/controller boundary.
# Never export exception text, model names, paths or arbitrary JSON values.
VALIDATION_REASONS = {
    'Sandbox returned invalid BLEND header': 'blend_header_invalid',
    'Sandbox returned invalid GLB header': 'glb_header_invalid',
    'Sandbox returned invalid GLB v2 length': 'glb_length_invalid',
    'Sandbox returned invalid GLB JSON chunk': 'glb_json_chunk_invalid',
    'Sandbox returned invalid glTF JSON': 'gltf_document_invalid',
    'Exported GLB has no scene nodes': 'glb_nodes_missing',
    'Exported GLB has invalid mesh list': 'glb_meshes_invalid',
    'Invalid preview metadata': 'preview_metadata_invalid',
    'GLB cannot reference external assets': 'glb_external_assets',
    'Sandbox report has invalid provenance': 'report_provenance_invalid',
    'Sandbox report has invalid objects': 'report_objects_invalid',
    'Invalid scene object name': 'object_name_invalid',
    'Invalid scene object identifier': 'object_id_invalid',
    'Duplicate scene object identity': 'object_id_duplicate',
    'Sandbox report must list both model files': 'report_artifact_list_invalid',
    'Unexpected sandbox artifact list': 'report_artifact_list_invalid',
    'Invalid inline PNG size': 'artifact_unclassified',
    'Invalid inline PNG signature': 'artifact_unclassified',
    'Invalid inline PNG dimensions': 'artifact_unclassified',
    'Invalid inline render metadata': 'report_provenance_invalid',
    'Invalid inline render file mismatch': 'report_artifact_list_invalid',
    'Inline render file mismatch': 'report_artifact_list_invalid',
    'Invalid inline render settings': 'report_provenance_invalid',
    'Sandbox artifact checksum mismatch': 'artifact_checksum_mismatch',
}
class ArtifactValidationError(ValueError):
    def __init__(self, reason, message):
        self.reason = reason
        super().__init__(message)

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
        raise ArtifactValidationError(reason, message) from None
    except (OSError, UnicodeError, TypeError, KeyError, IndexError, AttributeError):
        raise ArtifactValidationError('artifact_unclassified', 'Invalid artifact structure') from None
