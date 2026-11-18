"""Unit-test Modal lifecycle without network access or billing."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import MagicMock
from modal_provider.runner import ARTIFACT_NAMES, estimate_usd, run


class ModalProviderTests(unittest.TestCase):
    def sdk(self, code=0, copy_error=None):
        sdk = MagicMock()
        sb = sdk.Sandbox.create.return_value
        proc = sb.exec.return_value
        proc.wait.return_value = code
        proc.stdout.read.return_value = "BW_SMOKE PASS"
        proc.stderr.read.return_value = ""
        def copy(remote, local):
            if copy_error:
                raise copy_error
            Path(local).write_bytes(("artifact:" + Path(remote).name).encode())
        sb.filesystem.copy_to_local.side_effect = copy
        return sdk

    def test_success_and_termination(self):
        sdk = self.sdk()
        with TemporaryDirectory() as tmp:
            result = run(sdk, tmp)
            self.assertEqual(result["status"], "PASS")
            self.assertTrue(result["sandbox_terminated"])
            self.assertEqual(len(result["artifacts"]), 6)
            kwargs = sdk.Sandbox.create.call_args.kwargs
            self.assertTrue(kwargs["block_network"])
            self.assertEqual(kwargs["timeout"], 900)
            sdk.Sandbox.create.return_value.terminate.assert_called_once_with(wait=True)
            self.assertEqual(json.loads((Path(tmp) / "modal_run_report.json").read_text())["status"], "PASS")

    def test_revision_2_uploads_prior_blend_and_only_downloads_new_artifacts(self):
        sdk = self.sdk()
        with TemporaryDirectory() as tmp:
            original = Path(tmp) / "source.blend"
            original.write_bytes(b"previous saved Blender scene")
            out = Path(tmp) / "output"
            result = run(sdk, out, revision=2, input_blend=str(original))
            self.assertEqual(result["status"], "PASS")
            self.assertEqual(result["revision"], 2)
            self.assertEqual(len(result["artifacts"]), 3)
            self.assertEqual({a["name"] for a in result["artifacts"]},
                {"monster_v2.blend", "monster_v2.glb", "monster_v2.json"})
            sdk.Sandbox.create.return_value.filesystem.copy_from_local.assert_called_once_with(
                str(original.resolve()), "/workspace/out/monster_v1.blend")
            args = sdk.Sandbox.create.return_value.exec.call_args.args
            self.assertIn("revise_monster.py", " ".join(args))
            self.assertNotIn("run_smoke.sh", " ".join(args))
            sdk.Sandbox.create.return_value.terminate.assert_called_once_with(wait=True)

    def test_structured_revision_uploads_data_file_and_previous_scene(self):
        sdk=self.sdk()
        with TemporaryDirectory() as tmp:
            source=Path(tmp)/'v2.blend'
            source.write_bytes(b'prior scene')
            edit=Path(tmp)/'change.json'
            edit.write_text(json.dumps({'target':'Body','color':[0.5,0.2,0.8],
                'scale':[1,1,2]}))
            report=run(sdk,Path(tmp)/'output',revision=3,
                input_blend=str(source),edit_file=str(edit))
            self.assertEqual(report['revision'],3)
            self.assertEqual(len(report['artifacts']),3)
            names={a['name'] for a in report['artifacts']}
            self.assertEqual(names,{'monster_v3.blend','monster_v3.glb','monster_v3.json'})
            calls=sdk.Sandbox.create.return_value.filesystem.copy_from_local.call_args_list
            self.assertEqual(len(calls),2)
            self.assertEqual(calls[0].args,(str(source.resolve()),'/workspace/out/monster_v2.blend'))
            self.assertEqual(calls[1].args,(str(edit.resolve()),'/workspace/out/scene_edit.json'))
            args=sdk.Sandbox.create.return_value.exec.call_args.args
            self.assertIn('edit_scene.py',' '.join(args))
            self.assertNotIn('run_smoke.sh',' '.join(args))
            sdk.Sandbox.create.return_value.terminate.assert_called_once_with(wait=True)

    def test_structured_invalid_edit_never_allocates_modal(self):
        sdk=self.sdk()
        with TemporaryDirectory() as tmp:
            scene=Path(tmp)/'scene.blend'
            scene.write_bytes(b'scene')
            change=Path(tmp)/'change.json'
            change.write_text(json.dumps({'target':'Body','shell':'rm -rf /'}))
            with self.assertRaises(ValueError):
                run(sdk,Path(tmp)/'out',revision=3,input_blend=str(scene),edit_file=str(change))
            sdk.Sandbox.create.assert_not_called()

    def test_revision_rejects_missing_source_without_starting_modal(self):
        sdk = self.sdk()
        with TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "saved .blend"):
                run(sdk, tmp, revision=2, input_blend=str(Path(tmp) / "absent.blend"))
            sdk.Sandbox.create.assert_not_called()

    def test_execution_failure_always_terminates(self):
        sdk = self.sdk(code=1)
        with TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RuntimeError, "exit code 1"):
                run(sdk, tmp)
            sdk.Sandbox.create.return_value.terminate.assert_called_once_with(wait=True)
            self.assertEqual(json.loads((Path(tmp) / "modal_run_report.json").read_text())["status"], "FAILED")

    def test_copy_failure_always_terminates(self):
        sdk = self.sdk(copy_error=OSError("transport failure"))
        with TemporaryDirectory() as tmp:
            with self.assertRaises(OSError):
                run(sdk, tmp)
            sdk.Sandbox.create.return_value.terminate.assert_called_once_with(wait=True)

    def test_creation_failure(self):
        sdk = self.sdk()
        sdk.Sandbox.create.side_effect = RuntimeError("quota")
        with TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RuntimeError, "quota"):
                run(sdk, tmp)
            self.assertFalse(sdk.Sandbox.create.return_value.terminate.called)

    def test_price_estimate(self):
        self.assertEqual(estimate_usd(60, 2, 8192), 0.007932)
        self.assertEqual(len(ARTIFACT_NAMES), 6)


if __name__ == "__main__":
    unittest.main()
