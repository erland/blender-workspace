"""MODEL-001: models exceeding the former object/mesh ceilings survive save."""
import json
from pathlib import Path
import bpy

from blender_workspace_poc.apply_python import main as apply_model

# Use only one real bpy mesh, shared by many instances: count limits, not a
# high-poly benchmark. This remains fast and inexpensive in offline CI.
script = Path('/workspace/out/model.py')
script.write_text("""
import bpy
mesh=bpy.data.meshes.new('Shared Triangle')
mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)])
mesh.update()
for i in range(260):
    obj=bpy.data.objects.new('Mesh '+str(i),mesh)
    bpy.context.scene.collection.objects.link(obj)
for i in range(260):
    obj=bpy.data.objects.new('Empty '+str(i),None)
    bpy.context.scene.collection.objects.link(obj)
""")
import sys
sys.argv=['blender','--','NEW','/workspace/out/model.py','1']
apply_model()
report=json.loads(Path('/workspace/out/scene.json').read_text())
assert len(report['scene']['objects'])==520
assert sum(x['type']=='MESH' for x in report['scene']['objects'])==260
assert Path('/workspace/out/scene.blend').is_file()
print('BW_MODEL001_LARGE_SCENE PASS')
