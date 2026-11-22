"""DEV-049 validates bounded memory reservations for all three Modal runners.

Only mocked SDK interfaces; no paid Sandbox is started.
"""
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock,patch

from modal_provider.memory_config import DEFAULT_MEMORY_MIB,validate_memory_mib
from modal_provider.runner import run,RunnerDiagnostic
from modal_provider.render_runner import render
from modal_provider.glb_preview_runner import refresh


class MemoryConfigurationTests(unittest.TestCase):
    IMAGE="ghcr.io/erland/blender-workspace-blender:sha-"+"a"*40

    def test_default_and_allowed_memory(self):
        self.assertEqual(DEFAULT_MEMORY_MIB,2048)
        for m in (2048,4096,8192,16384):
            self.assertEqual(validate_memory_mib(m),m)
        for m in (-1,0,512,1024,1536,3072,32768,2048.0,"2048",None,True):
            with self.subTest(memory=m),self.assertRaises(ValueError):
                validate_memory_mib(m)

    def test_all_three_runners_pass_selected_memory_to_sdk(self):
        for size in (2048,4096,8192,16384):
            for mode in ("model","render","preview"):
                with self.subTest(size=size,mode=mode),TemporaryDirectory() as tmp:
                    src=Path(tmp)/"source.blend"
                    src.write_bytes(b"BLENDER test")
                    script=Path(tmp)/"model.py"
                    script.write_text("import bpy\n")
                    sdk=MagicMock()
                    sdk.Sandbox.create.side_effect=RuntimeError("synthetic boundary")
                    with patch("modal_provider.runner.blender_image_reference",return_value=self.IMAGE), \
                         patch("modal_provider.render_runner.blender_image_reference",return_value=self.IMAGE), \
                         patch("modal_provider.glb_preview_runner.blender_image_reference",return_value=self.IMAGE):
                        if mode=="model":
                            with self.assertRaises(RunnerDiagnostic):
                                run(sdk,Path(tmp)/"out",python_file=str(script),memory_mib=size)
                        elif mode=="render":
                            with self.assertRaisesRegex(RuntimeError,"synthetic boundary"):
                                render(sdk,Path(tmp)/"out",src,"CYCLES",512,512,16,memory_mib=size)
                        else:
                            with self.assertRaisesRegex(RuntimeError,"synthetic boundary"):
                                refresh(sdk,Path(tmp)/"out",src,memory_mib=size)
                    self.assertEqual(sdk.Sandbox.create.call_args.kwargs["memory"],size)

    def test_invalid_memory_rejected_before_paid_modal_api(self):
        for mode in ("model","render","preview"):
            with self.subTest(mode=mode),TemporaryDirectory() as tmp:
                src=Path(tmp)/"source.blend"
                src.write_bytes(b"BLENDER test")
                script=Path(tmp)/"model.py"
                script.write_text("import bpy\n")
                sdk=MagicMock()
                with self.assertRaises(ValueError):
                    if mode=="model":
                        run(sdk,Path(tmp)/"out",python_file=str(script),memory_mib=3072)
                    elif mode=="render":
                        render(sdk,Path(tmp)/"out",src,"CYCLES",512,512,16,memory_mib=3072)
                    else:
                        refresh(sdk,Path(tmp)/"out",src,memory_mib=3072)
                sdk.Sandbox.create.assert_not_called()


if __name__=="__main__":
    unittest.main()
