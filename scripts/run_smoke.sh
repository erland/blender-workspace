#!/usr/bin/env bash
# Local headless integration smoke, also the default Docker command.
# Both revisions run through the same Python-first worker as production.
set -euo pipefail
cd /workspace
OUT="${BW_OUTPUT:-/workspace/out}"
mkdir -p "$OUT/first"
export BW_OUTPUT="$OUT"
cp tests/sandbox_python_example.py "$OUT/model.py"
blender -b -t 2 --factory-startup --python blender_workspace_poc/apply_python.py -- NEW /workspace/out/model.py 1
mv "$OUT/scene.blend" "$OUT/scene.glb" "$OUT/scene.json" "$OUT/first/"
cp "$OUT/first/scene.blend" "$OUT/input.blend"
cat > "$OUT/model.py" <<'PY'
import bpy
bpy.data.objects['Python Cube'].location.x = 1.5
bpy.ops.mesh.primitive_cylinder_add(radius=0.5, depth=2, location=(4,0,0))
bpy.context.object.name = 'Python Cylinder'
PY
blender -b -t 2 --factory-startup --python blender_workspace_poc/apply_python.py -- /workspace/out/input.blend /workspace/out/model.py 2
python3 - <<'PY'
import json
from pathlib import Path
from modal_provider.artifact_validation import validate_python_outputs
first, second = Path('/workspace/out/first'), Path('/workspace/out')
assert validate_python_outputs(first)['object_count'] == 2
assert validate_python_outputs(second)['object_count'] == 3
older = json.loads((first/'scene.json').read_text())['scene']['objects']
newer = json.loads((second/'scene.json').read_text())['scene']['objects']
old = {x['name']: x['objectId'] for x in older}
new = {x['name']: x['objectId'] for x in newer}
assert old['Python Cube'] == new['Python Cube']
assert old['Python Sphere'] == new['Python Sphere']
assert new['Python Cylinder'] not in set(old.values())
print('BW_PYTHON_FIRST_SMOKE PASS', flush=True)
PY

# Offline CPU render regression. This is local Docker Blender, NOT a Modal job.
cp "$OUT/scene.blend" "$OUT/input.blend"
blender -b -t 2 --factory-startup --disable-autoexec \
  --python blender_workspace_poc/render_saved.py -- \
  --source /workspace/out/input.blend --output /workspace/out/render.png \
  --engine CYCLES --width 128 --height 128 --samples 1
python3 - <<'PY'
from pathlib import Path
import struct
image=Path('/workspace/out/render.png').read_bytes()
assert image[:8]==b'\x89PNG\r\n\x1a\n'
assert struct.unpack_from('>II',image,16)==(128,128)
print('BW_RENDER_SMOKE PASS',flush=True)
PY
