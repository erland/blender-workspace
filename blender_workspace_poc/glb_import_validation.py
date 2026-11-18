"""Constrained, self-contained GLB payload validation (no external URI loading)."""
import base64
import binascii
import json
import struct

MAX_GLB_BYTES=120_000
MAX_GLB_BASE64=160_000

def decode_embedded_glb(payload):
    if not isinstance(payload,str) or not 28<=len(payload)<=MAX_GLB_BASE64:
        raise ValueError('GLB base64 payload size invalid')
    try:
        raw=base64.b64decode(payload,validate=True)
    except (ValueError,binascii.Error):
        raise ValueError('Invalid GLB base64')
    if base64.b64encode(raw).decode('ascii')!=payload or not 20<=len(raw)<=MAX_GLB_BYTES:
        raise ValueError('Invalid GLB decoded size')
    if raw[:4]!=b'glTF' or struct.unpack_from('<II',raw,4)!=(2,len(raw)):
        raise ValueError('Invalid GLB v2 header')
    n,kind=struct.unpack_from('<I4s',raw,12)
    if kind!=b'JSON' or not 2<=n<=len(raw)-20 or n%4:
        raise ValueError('Invalid GLB JSON chunk')
    try:
        gltf=json.loads(raw[20:20+n].decode('utf-8').rstrip('\x00').strip())
    except (UnicodeError,ValueError):
        raise ValueError('Invalid GLB scene JSON')
    if (not isinstance(gltf,dict) or
        not isinstance(gltf.get('asset'),dict) or gltf['asset'].get('version')!='2.0' or
        not isinstance(gltf.get('meshes'),list) or not 1<=len(gltf['meshes'])<=128 or
        not isinstance(gltf.get('nodes'),list) or len(gltf['nodes'])>256 or
        not isinstance(gltf.get('scenes'),list) or len(gltf['scenes'])<1 or
        not isinstance(gltf.get('accessors'),list) or len(gltf['accessors'])>4096):
        raise ValueError('GLB scene shape unsupported')
    accessors=gltf['accessors']
    if any(not isinstance(a,dict) or type(a.get('count')) is not int or
           not 0<=a['count']<=100000 for a in accessors) or sum(
           a['count'] for a in accessors if isinstance(a,dict) and
           type(a.get('count')) is int)>200000:
        raise ValueError('GLB accessor complexity exceeds limits')
    buffers=gltf.get('buffers',[])
    images=gltf.get('images',[])
    required=gltf.get('extensionsRequired',[])
    if (not isinstance(buffers,list) or len(buffers)>1 or
        not isinstance(images,list) or len(images)>128 or
        not isinstance(required,list) or
        any(not isinstance(item,dict) or 'uri' in item for item in buffers+images) or
        any(not isinstance(v,str) or not v.startswith('KHR_') for v in required)):
        raise ValueError('External GLB resources are forbidden')
    end=20+n
    if end<len(raw):
        if len(raw)-end<8:
            raise ValueError('Invalid GLB BIN header')
        size,chunk=struct.unpack_from('<I4s',raw,end)
        if chunk!=b'BIN\x00' or size!=len(raw)-end-8:
            raise ValueError('Invalid GLB BIN chunk')
    return raw
