"""Real headless Blender regression for DEV-023 parenting safety."""
import sys
from pathlib import Path
import bpy

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from blender_workspace_poc.apply_operation import set_parent_preserving_world
from blender_workspace_poc.object_identity import PROPERTY

if '--' not in sys.argv:raise SystemExit('Missing test inputs')
old,new=sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.open_mainfile(filepath=old,load_ui=False)
source=bpy.data.objects['Copied Leg']
world_before=source.matrix_world.copy()
object_id=source[PROPERTY]
bpy.ops.wm.open_mainfile(filepath=new,load_ui=False)
child=bpy.data.objects['Parented Leg']
parent=bpy.data.objects['Desk Top']
assert child.parent is parent
assert child[PROPERTY]==object_id
assert all(abs(child.matrix_world[i][j]-world_before[i][j])<1e-5
           for i in range(4) for j in range(4)), 'World transform changed during parenting'
try:
    set_parent_preserving_world(parent,child)
except ValueError:
    pass
else:
    raise AssertionError('Circular parenting must fail')
assert parent.parent is None, 'Failed cycle must not mutate hierarchy'
try:
    set_parent_preserving_world(child,child)
except ValueError:
    pass
else:
    raise AssertionError('Self parenting must fail')
assert child.parent is parent
set_parent_preserving_world(child,None)
assert child.parent is None
assert all(abs(child.matrix_world[i][j]-world_before[i][j])<1e-5
           for i in range(4) for j in range(4)), 'World transform changed during unparenting'
print('BW_DEV023_HIERARCHY PASS')
