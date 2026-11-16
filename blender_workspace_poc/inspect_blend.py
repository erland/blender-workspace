"""Inspect a Blender file in a fresh process."""
import json
import sys
import bpy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from blender_workspace_poc.common import inspect_scene
if '--' not in sys.argv: raise SystemExit('usage: blender -b --python inspect_blend.py -- FILE')
path=sys.argv[sys.argv.index('--')+1]
bpy.ops.wm.open_mainfile(filepath=path,load_ui=False)
print('BW_INSPECTION='+json.dumps(inspect_scene(),sort_keys=True))
