"""Controlled Blender scene changes; no user scripts or arbitrary property paths."""
import json
import sys
import time
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from blender_workspace_poc.common import ensure_output,save_scene,export_glb,write_manifest
from blender_workspace_poc.scene_edit_validation import validate_edit

def apply_edit(edit):
    obj=bpy.data.objects.get('Body')
    if obj is None or obj.type!='MESH':
        raise RuntimeError('Expected Body mesh missing')
    if 'color' in edit:
        mat=obj.active_material
        if mat is None:raise RuntimeError('Body material missing')
        mat=mat.copy()
        obj.active_material=mat
        rgba=tuple(edit['color'])+(1.0,)
        mat.diffuse_color=rgba
        if mat.use_nodes:
            bsdf=mat.node_tree.nodes.get('Principled BSDF')
            if bsdf:bsdf.inputs['Base Color'].default_value=rgba
    if 'location' in edit:obj.location=tuple(edit['location'])
    if 'scale' in edit:obj.scale=tuple(edit['scale'])
    if bpy.data.actions.get('WalkCycle') is None:
        raise RuntimeError('WalkCycle lost after reload')

def main():
    if '--' not in sys.argv:raise SystemExit('Expected -- INPUT_BLEND EDIT_JSON REVISION')
    args=sys.argv[sys.argv.index('--')+1:]
    if len(args)!=3:raise SystemExit('Expected input, edit and revision')
    source,edit_file,revision=args
    revision=int(revision)
    if not 2<=revision<=99999999:raise ValueError('Invalid revision')
    edit=validate_edit(json.loads(Path(edit_file).read_text(encoding='utf-8')))
    start=time.monotonic()
    bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False)
    apply_edit(edit)
    out=ensure_output()
    blend=out/f'monster_v{revision}.blend'
    glb=out/f'monster_v{revision}.glb'
    save_scene(blend);export_glb(glb)
    write_manifest(out/f'monster_v{revision}.json','structured_edit',[blend,glb])
    print(f'BW_METRIC stage=structured_edit duration_seconds={time.monotonic()-start:.3f}')
if __name__=='__main__':main()
