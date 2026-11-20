"""Execute user-generated Python only inside a short-lived Modal Sandbox.

The trusted Modal controller transfers script and optional verified predecessor;
no tokens, network or host directories are mounted into this Blender process.
All artifacts are regenerated *after* user code returns successfully.
"""
import sys
from pathlib import Path
import bpy

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from blender_workspace_poc.object_identity import ensure_object_ids
from blender_workspace_poc.common import ensure_output, export_glb, write_manifest

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
    if not 1<=len(data)<=16384 or b'\x00' in data or not data.strip():
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
    objects=list(bpy.data.objects)
    meshes=[obj for obj in objects if obj.type=='MESH']
    if len(objects)<1 or len(objects)>512 or len(meshes)>256:
        raise ValueError('Scene object count outside bounded output limits')
    # Safety ceiling, not a GLB polygon budget. Higher-detail meshes and
    # Blender hair/curves remain part of the authoritative .blend.
    if sum(len(obj.data.vertices) for obj in meshes)>2_000_000 or sum(
        len(obj.data.polygons) for obj in meshes)>1_000_000:
        raise ValueError('Scene topology exceeds bounded processing limits')
    out=ensure_output()
    blend,glb,report=(out/'scene.blend',out/'scene.glb',out/'scene.json')
    # An uncompressed BLEND allows the trusted controller to verify its
    # native BLENDER header without parsing untrusted compressed input.
    bpy.ops.wm.save_as_mainfile(filepath=str(blend),compress=False)
    preview={'format':'glb','status':'unavailable','reason':'export_failed'}
    files=[blend]
    try:
        export_glb(glb)
        if not glb.is_file() or glb.stat().st_size==0:
            raise RuntimeError('Empty GLB export')
        files.append(glb)
        # An exported GLB is a preview, not a proof of fidelity. Hair curves,
        # procedural geometry and Blender-specific shader nodes may be absent.
        preview={'format':'glb','status':'available','fidelity':'unverified'}
    except Exception:
        # Preview failure must never erase a valid native Blender scene.
        glb.unlink(missing_ok=True)
    write_manifest(report,'sandbox_python',files,preview=preview)
    print('BW_SANDBOX_PYTHON PASS',flush=True)

if __name__=='__main__':
    main()
