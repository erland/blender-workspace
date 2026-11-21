"""Export a derived GLB from an immutable existing BLEND, without user Python."""
import json
import sys
from pathlib import Path
import bpy

# Blender's --python entrypoint can omit /workspace from sys.path; do not
# rely on Blender inheriting PYTHONPATH for the trusted re-export.
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from blender_workspace_poc.common import export_glb
from blender_workspace_poc.apply_python import preview_document,material_check
from blender_workspace_poc.glb_material_fallback import glb_material_fallback,source_material_stats


def main():
    if '--' not in sys.argv:
        raise ValueError('Missing fixed arguments')
    args=sys.argv[sys.argv.index('--')+1:]
    if len(args)!=2 or args[0]!='/workspace/out/input.blend' or args[1]!='/workspace/out/preview.glb':
        raise ValueError('Invalid preview command arguments')
    source=Path(args[0])
    if not source.is_file() or source.stat().st_size>256*1024*1024:
        raise ValueError('Invalid source')
    bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
    before=source_material_stats()
    with glb_material_fallback() as data:
        export_glb(args[1])
    document=preview_document(args[1])
    if document is None:
        raise ValueError('Invalid preview')
    check=material_check(document,before,data['fallbackMaterials'])
    if check['status']=='lost':
        raise ValueError('Preview lost source material assignments')
    Path('/workspace/out/preview-report.json').write_text(
        json.dumps({'materialCheck':check,'fidelity':'unverified'}))
    print('BW_PREVIEW_REFRESH PASS',flush=True)


if __name__=='__main__':
    main()
