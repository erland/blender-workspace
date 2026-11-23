"""DEV-052: real headless Blender proves external image textures survive local download.

The test deliberately deletes the original texture before reopening the
saved BLEND. This avoids mistaking a cached source file for packed portability.
"""
import sys
import tempfile
from pathlib import Path
import bpy

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from blender_workspace_poc.portable_scene import pack_scene_resources

bpy.ops.wm.read_factory_settings(use_empty=True)
with tempfile.TemporaryDirectory(prefix='bw-portable-') as tmp:
    root=Path(tmp)
    texture_file=root/'source-texture.png'
    native_file=root/'portable-scene.blend'

    generated=bpy.data.images.new('Texture generator',width=4,height=4)
    generated.pixels[:]=[0.9,0.2,0.1,1.0]*16
    generated.filepath_raw=str(texture_file)
    generated.file_format='PNG'
    generated.save()

    image=bpy.data.images.load(str(texture_file),check_existing=False)
    image.name='Standalone texture'
    bpy.ops.mesh.primitive_cube_add()
    mesh=bpy.context.object
    mat=bpy.data.materials.new('Texture paint')
    mat.use_nodes=True
    tex=mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image=image
    mat.node_tree.links.new(tex.outputs['Color'],
        mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    mesh.data.materials.append(mat)

    status=pack_scene_resources()
    assert status['schemaVersion']==1,status
    assert status['status']=='complete',status
    assert status['packedCount']>=1,status
    assert status['externalCount']==0,status
    assert image.packed_file is not None,status
    bpy.ops.wm.save_as_mainfile(filepath=str(native_file),compress=False)
    assert native_file.read_bytes().startswith(b'BLENDER')

    texture_file.unlink()
    bpy.ops.wm.open_mainfile(filepath=str(native_file),load_ui=False,use_scripts=False)
    reopened=bpy.data.images['Standalone texture']
    assert reopened.packed_file is not None
    assert reopened.packed_file.size>0
    assert bpy.data.objects['Cube'].data.materials[0].node_tree.nodes.get(
        'Image Texture').image==reopened
    assert pack_scene_resources()['status']=='complete'

print('BW_DEV052_PORTABLE_BLENDER PASS',flush=True)
