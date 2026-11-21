"""Execute user-generated Python only inside a short-lived Modal Sandbox.

The trusted Modal controller transfers script and optional verified predecessor;
no tokens, network or host directories are mounted into this Blender process.
All artifacts are regenerated *after* user code returns successfully.
"""
import sys
import json
import signal
import struct
from pathlib import Path
import bpy

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from blender_workspace_poc.object_identity import ensure_object_ids
from blender_workspace_poc.common import ensure_output, export_glb, write_manifest
from blender_workspace_poc.glb_material_fallback import glb_material_fallback, source_material_stats

def preview_document(path):
    # The GLB exporter can succeed while generating a preview without scene
    # nodes (e.g. an all-curves scene). This is not a modeling failure.
    if Path(path).stat().st_size > 128 * 1024 * 1024:
        return None
    data=Path(path).read_bytes()
    if len(data)<20 or data[:4]!=b'glTF':
        return False
    version,total=struct.unpack_from('<II',data,4)
    if version!=2 or total!=len(data):
        return False
    size,kind=struct.unpack_from('<I4s',data,12)
    if kind!=b'JSON' or size==0 or size%4 or 20+size>len(data):
        return False
    document=json.loads(data[20:20+size])
    if not isinstance(document,dict) or document.get('asset',{}).get('version')!='2.0':
        return False
    if not isinstance(document.get('nodes'),list) or not document['nodes']:
        return False
    if not isinstance(document.get('meshes',[]),list):
        return False
    for collection in ('buffers','images'):
        for item in document.get(collection,[]):
            if not isinstance(item,dict) or 'uri' in item:
                return False
    return document


def preview_is_structurally_usable(path):
    return preview_document(path) is not None


def material_check(document, source, fallbacks):
    materials=document.get('materials', [])
    primitives=sum('material' in item for mesh in document.get('meshes', [])
                   for item in mesh.get('primitives', []))
    count=len(materials) if isinstance(materials,list) else 0
    return {**source, 'exportedMaterials':count,
            'assignedPrimitives':primitives,
            'fallbackMaterials':fallbacks,
            'status':('not_applicable' if source['sourceMaterialSlots']==0 else
                      'lost' if count==0 or primitives==0 else 'ok')}

def main():
    if '--' not in sys.argv:
        raise SystemExit('Missing fixed Python operation parameters')
    args=sys.argv[sys.argv.index('--')+1:]
    if len(args)!=3:
        raise SystemExit('Expected SOURCE_OR_NEW SCRIPT_FILE REVISION')
    source,script_file,revision=args
    revision=int(revision)
    if not 1<=revision<=99999999:
        raise ValueError('Invalid revision')
    script=Path(script_file)
    if script.resolve()!=Path('/workspace/out/model.py'):
        raise ValueError('Script location is fixed by the trusted controller')
    data=script.read_bytes()
    if not 1<=len(data)<=65536 or b'\x00' in data or not data.strip():
        raise ValueError('Invalid Python source length or content')
    code=compile(data,'<blender-workspace-user-code>','exec')
    if source=='NEW':
        if revision!=1:
            raise ValueError('Initial scene requires revision 1')
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
    else:
        if revision<2 or source!='/workspace/out/input.blend':
            raise ValueError('Only an explicit saved scene predecessor is supported')
        bpy.ops.wm.open_mainfile(filepath=source,load_ui=False,use_scripts=False)
    ensure_object_ids(bpy.data.objects)
    # Intentional unrestricted bpy/Python API *inside* the isolated Sandbox.
    exec(code,{'__name__':'__main__','bpy':bpy})
    ensure_object_ids(bpy.data.objects)
    # Scene detail is bounded by Sandbox memory/time and artifact size, not
    # arbitrary counts of objects, meshes, vertices or polygons.
    if not bpy.data.objects:
        raise ValueError('Scene must contain at least one object')
    out=ensure_output()
    blend,glb,report=(out/'scene.blend',out/'scene.glb',out/'scene.json')
    # An uncompressed BLEND allows the trusted controller to verify its
    # native BLENDER header without parsing untrusted compressed input.
    bpy.ops.wm.save_as_mainfile(filepath=str(blend),compress=False)
    preview={'format':'glb','status':'unavailable','reason':'export_failed'}
    files=[blend]
    def preview_timeout(_signum,_frame):
        raise TimeoutError('Optional preview export exceeded its time budget')
    previous_handler=signal.getsignal(signal.SIGALRM)
    try:
        signal.signal(signal.SIGALRM,preview_timeout)
        signal.alarm(90)  # preview must not consume the whole paid sandbox budget
        source_stats=source_material_stats()
        with glb_material_fallback() as fallback_stats:
            export_glb(glb)
        document=preview_document(glb) if glb.is_file() else None
        if document is None:
            raise RuntimeError('Unusable GLB preview')
        check=material_check(document,source_stats,fallback_stats['fallbackMaterials'])
        files.append(glb)
        # An exported GLB is a preview, not a proof of fidelity. Hair curves,
        # procedural geometry and Blender-specific shader nodes may be absent.
        preview={'format':'glb','status':'available','fidelity':'unverified',
                 'materialCheck':check}
    except Exception:
        # Preview failure must never erase a valid native Blender scene.
        glb.unlink(missing_ok=True)
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM,previous_handler)
    write_manifest(report,'sandbox_python',files,preview=preview)
    print('BW_SANDBOX_PYTHON PASS',flush=True)

if __name__=='__main__':
    main()
