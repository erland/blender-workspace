"""Explicitly charged, sandboxed GLB re-export from an existing BLEND."""
import argparse
import os
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:sys.path.insert(0,str(ROOT))
from modal_provider.runner import blender_image_reference
from modal_provider.artifact_validation import _file

def refresh(sdk,out_dir,input_blend):
    source=Path(input_blend)
    if source.is_symlink() or not source.is_file() or not 0<source.stat().st_size<=256*1024*1024:
        raise ValueError('Invalid source BLEND')
    image_ref=blender_image_reference()
    out=Path(out_dir)
    out.mkdir(parents=True,exist_ok=True)
    sandbox=None
    try:
        app=sdk.App.lookup('blender-workspace-dev002',create_if_missing=True)
        image=sdk.Image.from_registry(image_ref,add_python='3.11')
        sandbox=sdk.Sandbox.create('sleep','360',app=app,image=image,cpu=2,
            memory=8192,timeout=360,workdir='/workspace',block_network=True)
        sandbox.filesystem.copy_from_local(str(source.resolve()),'/workspace/out/input.blend')
        process=sandbox.exec('blender','-b','--factory-startup','--disable-autoexec',
            '--python','/workspace/blender_workspace_poc/refresh_glb.py','--',
            '/workspace/out/input.blend','/workspace/out/preview.glb')
        rc=process.wait()
        output=process.stdout.read()[-4096:]
        process.stderr.read()
        if rc!=0 or 'BW_PREVIEW_REFRESH PASS' not in output:
            raise RuntimeError('GLB preview refresh failed')
        sandbox.filesystem.copy_to_local('/workspace/out/preview.glb',str(out/'preview.glb'))
        sandbox.filesystem.copy_to_local('/workspace/out/preview-report.json',str(out/'preview-report.json'))
        # Bounded size and header checked again before publication.
        preview=_file(out,'preview.glb',128*1024*1024,header_only=True)
        if preview[:4]!=b'glTF' or len(preview)<12:
            raise ValueError('Invalid GLB')
        _file(out,'preview-report.json',1024*1024)
        return True
    finally:
        if sandbox is not None:sandbox.terminate(wait=True)


if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--out',required=True)
    p.add_argument('--input-blend',required=True)
    a=p.parse_args()
    try:
        import modal
        refresh(modal,a.out,a.input_blend)
    except Exception:
        print('BW_PREVIEW_REFRESH_ERROR',file=sys.stderr)
        sys.exit(1)
