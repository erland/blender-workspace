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
