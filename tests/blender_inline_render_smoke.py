"""Real Blender DEV-045 integration: same-process render, framing and fallback."""
import json
import struct
import sys
from pathlib import Path
from unittest.mock import patch
import bpy

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from blender_workspace_poc import apply_python
from modal_provider.artifact_validation import validate_python_outputs,validate_png_preview

out=Path('/workspace/out')
out.mkdir(exist_ok=True,parents=True)
script=out/'model.py'
script.write_text("""import bpy
bpy.ops.mesh.primitive_cube_add(size=2)
bpy.context.object.name = 'Visible cube'
""")
original_argv=sys.argv[:]
try:
    sys.argv=['apply_python.py','--','NEW',str(script),'1','RENDER']
    apply_python.main()
    png=out/'scene.png'
    assert validate_png_preview(png)
    report=json.loads((out/'scene.json').read_text())
    assert report['inlineRender']['status']=='available',report.get('inlineRender')
    assert report['inlineRender']['framing']=='auto-stored-bounds'
    assert set(a['path'] for a in report['artifacts'])=={'scene.blend','scene.glb','scene.png'}
    assert report['timings']['inlineRenderSeconds']>0
    assert validate_python_outputs(out)['object_count']==1
    bpy.ops.wm.open_mainfile(filepath=str(out/'scene.blend'),load_ui=False,use_scripts=False)
    assert 'Visible cube' in bpy.data.objects
    assert 'Temporary preview camera' not in bpy.data.objects
    print('BW_DEV045_INLINE_RENDER PASS',flush=True)
    # Rendering failure is optional: publishing the valid scene must succeed.
    with patch.object(apply_python,'render_inline',side_effect=RuntimeError('synthetic failure')):
        apply_python.main()
    assert not png.exists()
    report=json.loads((out/'scene.json').read_text())
    assert report['inlineRender']['status']=='unavailable'
    assert {a['path'] for a in report['artifacts']}=={'scene.blend','scene.glb'}
    validate_python_outputs(out)
    print('BW_DEV045_RENDER_FALLBACK PASS',flush=True)
finally:
    sys.argv=original_argv
