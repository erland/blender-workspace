"""DEV-048: all billable Modal jobs share a configurable app name.

SDK mocks terminate before sandbox allocation; these tests never call Modal.
"""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import MagicMock, patch

from modal_provider.app_config import DEFAULT_MODAL_APP_NAME, modal_app_name
from modal_provider.runner import run, RunnerDiagnostic
from modal_provider.render_runner import render
from modal_provider.glb_preview_runner import refresh


class ModalAppNameTests(unittest.TestCase):
    IMAGE = "ghcr.io/erland/blender-workspace-blender:sha-" + "a" * 40

    def test_default_name_and_bounded_override(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(DEFAULT_MODAL_APP_NAME, "blender-workspace")
            self.assertEqual(modal_app_name(), "blender-workspace")
        with patch.dict(os.environ, {"MODAL_APP_NAME": "my-blender-app"}):
            self.assertEqual(modal_app_name(), "my-blender-app")
        for bad in ("", "Blender-Workspace", "bad_name", "-bad", "bad-",
                    "x", "a"*65, "name with spaces", "../other"):
            with self.subTest(name=bad):
                with self.assertRaisesRegex(ValueError, "MODAL_APP_NAME"):
                    modal_app_name(bad)

    def test_all_three_runners_resolve_one_shared_app(self):
        for name in ("blender-workspace", "my-custom-modal-app"):
            for mode in ("model", "render", "preview"):
                with self.subTest(name=name, mode=mode), TemporaryDirectory() as temp:
                    source=Path(temp)/"input.blend"
                    source.write_bytes(b"BLENDER example")
                    script=Path(temp)/"model.py"
                    script.write_text("import bpy\n", encoding="utf8")
                    out=Path(temp)/"out"
                    sdk=MagicMock()
                    sdk.Sandbox.create.side_effect=RuntimeError("synthetic sandbox boundary")
                    with patch.dict(os.environ, {"MODAL_APP_NAME":name,
                          "MODAL_BLENDER_IMAGE":self.IMAGE}):
                        if mode=="model":
                            with self.assertRaises(RunnerDiagnostic):
                                run(sdk,out,python_file=str(script))
                        elif mode=="render":
                            with self.assertRaisesRegex(RuntimeError,"synthetic sandbox"):
                                render(sdk,out,source,"CYCLES",512,512,16)
                        else:
                            with self.assertRaisesRegex(RuntimeError,"synthetic sandbox"):
                                refresh(sdk,out,source)
                    sdk.App.lookup.assert_called_once_with(name,create_if_missing=True)
                    sdk.Sandbox.create.assert_called_once()

    def test_invalid_app_name_cannot_allocate_sandbox(self):
        for mode in ("model", "render", "preview"):
            with self.subTest(mode=mode), TemporaryDirectory() as temp:
                source=Path(temp)/"input.blend"
                source.write_bytes(b"BLENDER example")
                script=Path(temp)/"model.py"
                script.write_text("pass\n")
                sdk=MagicMock()
                with patch.dict(os.environ, {"MODAL_APP_NAME":"../invalid",
                     "MODAL_BLENDER_IMAGE":self.IMAGE}):
                    if mode=="model":
                        with self.assertRaises(RunnerDiagnostic):
                            run(sdk,Path(temp)/"out",python_file=str(script))
                    elif mode=="render":
                        with self.assertRaisesRegex(ValueError,"MODAL_APP_NAME"):
                            render(sdk,Path(temp)/"out",source,"CYCLES",512,512,16)
                    else:
                        with self.assertRaisesRegex(ValueError,"MODAL_APP_NAME"):
                            refresh(sdk,Path(temp)/"out",source)
                sdk.App.lookup.assert_not_called()
                sdk.Sandbox.create.assert_not_called()


if __name__=="__main__":
    unittest.main()
