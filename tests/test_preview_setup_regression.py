"""Regression checks for render framing and preview setup without Blender/Modal."""
import ast
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
PREVIEW=ROOT/'blender_workspace_poc'/'preview_setup.py'
RENDER=ROOT/'blender_workspace_poc'/'render_saved.py'
INLINE=ROOT/'blender_workspace_poc'/'inline_render.py'

class AutoPreviewRegressionTests(unittest.TestCase):
    def test_syntax(self):
        for p in (PREVIEW,RENDER,INLINE):
            ast.parse(p.read_text(),filename=str(p))

    def test_shared_camera_used_by_both_render_paths(self):
        saved=RENDER.read_text()
        inline=INLINE.read_text()
        self.assertIn('from blender_workspace_poc.preview_setup import frame_model, add_preview_lighting',saved)
        self.assertIn('from blender_workspace_poc.preview_setup import frame_model, add_preview_lighting',inline)
        self.assertIn('elif scene.camera is None:',saved)
        self.assertIn('frame_model(scene, width/height)',saved)
        self.assertIn('frame_model(scene)',inline)
        self.assertIn('add_preview_lighting(scene,scene.camera)',saved)
        self.assertIn('add_preview_lighting(scene,camera)',inline)
        self.assertNotIn('ortho_scale=9',saved)
        self.assertNotIn('energy=800',saved)

    def test_preview_filters_hidden_and_non_renderable_assets(self):
        source=PREVIEW.read_text()
        self.assertIn('obj.hide_render',source)
        self.assertIn('obj.matrix_world @ Vector(p)',source)
        self.assertIn('horizontal/max(aspect,1e-6)',source)
        self.assertIn('any(o.type==\'LIGHT\' and not o.hide_render',source)
        self.assertIn('scene.world.copy()',source)

if __name__=='__main__':
    unittest.main()
