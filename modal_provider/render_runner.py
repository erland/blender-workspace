"""Separate owner-billed, explicitly requested render runner. No retries."""
import argparse
import json
import os
from pathlib import Path
import struct
import sys
ROOT=Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0,str(ROOT))
from modal_provider.runner import blender_image_reference
from modal_provider.app_config import modal_app_name
from modal_provider.memory_config import DEFAULT_MEMORY_MIB,validate_memory_mib
from modal_provider.resource_transfer import validated_resources,transfer_resources

PNG_SIGNATURE=b'\x89PNG\r\n\x1a\n'
MAX_PNG=16*1024*1024

def validate_png(path, width, height):
    p=Path(path)
    if p.is_symlink() or not p.is_file() or not 33<=p.stat().st_size<=MAX_PNG:
        raise ValueError('invalid_render_file')
    with p.open('rb') as stream:
        h=stream.read(33)
    if h[:8]!=PNG_SIGNATURE or h[12:16]!=b'IHDR':
        raise ValueError('invalid_png_header')
    w,hgt=struct.unpack_from('>II',h,16)
    if (w,hgt)!=(width,height) or h[24]!=8 or h[25] not in (2,6):
        raise ValueError('invalid_png_dimensions')

def render(sdk, out_dir, input_blend, engine, width, height, samples, camera_json=None, memory_mib=DEFAULT_MEMORY_MIB,
           resource_manifest=None):
    validate_memory_mib(memory_mib)
    if engine not in ('CYCLES','BLENDER_EEVEE_NEXT') or width<128 or height<128:
        raise ValueError('Invalid render options')
    if camera_json is None:
        if width>1024 or height>1024:
            raise ValueError('Invalid render options')
    elif (engine!='CYCLES' or samples!=16 or min(width,height)!=512
          or max(width,height)>2048 or len(camera_json)>1024):
        raise ValueError('Invalid viewer render')
    if samples not in (8,16,32) or engine=='CYCLES' and samples>32:
        raise ValueError('Invalid samples')
    source=Path(input_blend)
    if source.is_symlink() or not source.is_file() or source.stat().st_size>256*1024*1024:
        raise ValueError('Invalid source model')
    resources=validated_resources(resource_manifest)
    image_ref=blender_image_reference()
    sandbox=None
    out=Path(out_dir)
    out.mkdir(parents=True,exist_ok=True)
    try:
        image=sdk.Image.from_registry(image_ref,add_python='3.11')
        app=sdk.App.lookup(modal_app_name(),create_if_missing=True)
        sandbox=sdk.Sandbox.create('sleep','360',app=app,image=image,cpu=2,
                                   memory=memory_mib,timeout=360,workdir='/workspace',
                                   block_network=True)
        transfer_resources(sandbox,resources)
        sandbox.filesystem.copy_from_local(str(source.resolve()),'/workspace/out/input.blend')
        render_args=['--source','/workspace/out/input.blend','--output','/workspace/out/render.png',
                     '--engine',engine,'--width',str(width),'--height',str(height),'--samples',str(samples)]
        if camera_json is not None:
            render_args+=['--camera-json',camera_json]
        proc=sandbox.exec('blender','-b','--factory-startup','--disable-autoexec','--python',
          '/workspace/blender_workspace_poc/render_saved.py','--',*render_args)
        code=proc.wait()
        stdout=proc.stdout.read()[-4096:]
        proc.stderr.read()
        if code!=0 or 'BW_SANDBOX_RENDER PASS' not in stdout:
            raise RuntimeError('render_execution_failed')
        sandbox.filesystem.copy_to_local('/workspace/out/render.png',str(out/'render.png'))
        validate_png(out/'render.png',width,height)
        return True
    finally:
        if sandbox is not None:
            sandbox.terminate(wait=True)

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--out',required=True)
    p.add_argument('--input-blend',required=True)
    p.add_argument('--engine',required=True)
    p.add_argument('--width',required=True,type=int)
    p.add_argument('--height',required=True,type=int)
    p.add_argument('--samples',required=True,type=int)
    p.add_argument('--camera-json',default=None)
    p.add_argument('--memory-mib',type=int,default=DEFAULT_MEMORY_MIB)
    p.add_argument('--resource-manifest')
    a=p.parse_args()
    try:
        import modal
        render(modal,a.out,a.input_blend,a.engine,a.width,a.height,a.samples,a.camera_json,a.memory_mib,
               a.resource_manifest)
    except Exception:
        # Credentials, Blender output and Modal exceptions must never leak.
        print('BW_RENDER_ERROR',file=sys.stderr)
        sys.exit(1)
