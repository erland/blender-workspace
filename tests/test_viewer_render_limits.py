"""Regression tests for viewer Cycles short-edge rendering limits.

These tests mock Modal/Blender and never start billable render jobs.
"""
import importlib.util
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import types
import unittest
from unittest.mock import MagicMock, patch

from modal_provider.render_runner import render


class ViewerCyclesLimitsTests(unittest.TestCase):
    CAMERA = '{"type":"perspective"}'

    def test_viewer_512_short_edge_accepted_before_modal_allocation(self):
        for width, height in ((627, 512), (512, 910), (2048, 512), (512, 2048), (512, 512)):
            with self.subTest(size=(width, height)), TemporaryDirectory() as tmp:
                source = Path(tmp) / 'scene.blend'
                source.write_bytes(b'BLENDER test')
                sdk = MagicMock()
                sdk.Sandbox.create.side_effect = RuntimeError('allocation reached')
                with patch('modal_provider.render_runner.blender_image_reference',
                           return_value='ghcr.io/example/blender:sha-' + 'a' * 40):
                    with self.assertRaisesRegex(RuntimeError, 'allocation reached'):
                        render(sdk, Path(tmp) / 'out', source, 'CYCLES',
                               width, height, 16, self.CAMERA)
                sdk.Sandbox.create.assert_called_once()

    def test_invalid_viewer_sizes_rejected_without_modal(self):
        for width, height, samples, engine, camera in (
            (455, 256, 16, 'CYCLES', self.CAMERA),
            (1024, 1024, 16, 'CYCLES', self.CAMERA),
            (2049, 512, 16, 'CYCLES', self.CAMERA),
            (512, 2049, 16, 'CYCLES', self.CAMERA),
            (627, 512, 8, 'CYCLES', self.CAMERA),
            (627, 512, 16, 'BLENDER_EEVEE_NEXT', self.CAMERA),
            (627, 512, 16, 'CYCLES', 'x' * 1025),
        ):
            with self.subTest(size=(width, height), engine=engine, samples=samples):
                sdk = MagicMock()
                with self.assertRaises(ValueError):
                    render(sdk, '.', '.', engine, width, height, samples, camera)
                sdk.Sandbox.create.assert_not_called()

    def test_project_render_limits_are_unchanged(self):
        for width, height in ((256, 256), (512, 512), (1024, 1024)):
            with self.subTest(size=(width, height)), TemporaryDirectory() as tmp:
                source = Path(tmp) / 'scene.blend'
                source.write_bytes(b'BLENDER test')
                sdk = MagicMock()
                sdk.Sandbox.create.side_effect = RuntimeError('allocation reached')
                with patch('modal_provider.render_runner.blender_image_reference',
                           return_value='ghcr.io/example/blender:sha-' + 'a' * 40):
                    with self.assertRaisesRegex(RuntimeError, 'allocation reached'):
                        render(sdk, Path(tmp) / 'out', source, 'CYCLES',
                               width, height, 16)
                sdk.Sandbox.create.assert_called_once()
        sdk = MagicMock()
        with self.assertRaises(ValueError):
            render(sdk, '.', '.', 'CYCLES', 2048, 512, 16)
        sdk.Sandbox.create.assert_not_called()

    def test_blender_script_matches_viewer_limits(self):
        # Import the trusted render script with a stub bpy module, without
        # requiring Blender or launching a render. An accepted call reaches
        # the mocked file-opening boundary; invalid calls do not.
        root = Path(__file__).resolve().parents[1]
        spec = importlib.util.spec_from_file_location(
            'blender_render_limits_test', root / 'blender_workspace_poc' / 'render_saved.py')
        fake_bpy = types.ModuleType('bpy')
        fake_bpy.ops = MagicMock()
        fake_bpy.ops.wm.open_mainfile.side_effect = RuntimeError('validated options')
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'bpy': fake_bpy}):
            spec.loader.exec_module(module)
        for width, height, camera in (
            (627, 512, self.CAMERA), (2048, 512, self.CAMERA),
            (512, 2048, self.CAMERA), (512, 512, None),
        ):
            with self.subTest(size=(width, height), viewer=camera is not None):
                with self.assertRaisesRegex(RuntimeError, 'validated options'):
                    module.render('/workspace/out/input.blend', '/workspace/out/render.png',
                                  'CYCLES', width, height, 16, camera)
        for width, height, camera in (
            (256, 256, self.CAMERA), (2049, 512, self.CAMERA),
            (2048, 512, None),
        ):
            with self.subTest(size=(width, height), viewer=camera is not None):
                with self.assertRaises(ValueError):
                    module.render('/workspace/out/input.blend', '/workspace/out/render.png',
                                  'CYCLES', width, height, 16, camera)


if __name__ == '__main__':
    unittest.main()
