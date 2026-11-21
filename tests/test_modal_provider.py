"""Unit coverage for the Python-only, owner-billed Modal Sandbox controller."""
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import MagicMock, patch

from modal_provider.runner import ARTIFACT_NAMES, estimate_usd, run, blender_image_reference, RunnerDiagnostic


class ModalProviderTests(unittest.TestCase):
    def setUp(self):
        self.image = "ghcr.io/erland/blender-workspace-blender:sha-" + "a" * 40
        self.env = patch.dict(os.environ, {"MODAL_BLENDER_IMAGE": self.image})
        self.env.start()
        self.addCleanup(self.env.stop)

    def sdk(self, exit_code=0, marker="BW_SANDBOX_PYTHON PASS", copy_error=None, preview=False):
        sdk = MagicMock()
        sandbox = sdk.Sandbox.create.return_value
        proc = sandbox.exec.return_value
        proc.wait.return_value = exit_code
        proc.stdout.read.return_value = marker
        proc.stderr.read.return_value = ""

        def copy(remote, local):
            if copy_error:
                raise copy_error
            if Path(remote).name == "scene.json":
                paths=["scene.blend"]+(["scene.glb"] if preview else [])
                Path(local).write_text(json.dumps({"artifacts":[{"path":p} for p in paths],
                    "preview":{"status":"available" if preview else "unavailable"}}))
            else:
                Path(local).write_bytes(("artifact:" + Path(remote).name).encode())

        sandbox.filesystem.copy_to_local.side_effect = copy
        return sdk

    def files(self, tmp):
        script = Path(tmp) / "model.py"
        script.write_text("import bpy\nbpy.ops.mesh.primitive_cube_add()", encoding="utf8")
        prior = Path(tmp) / "prior.blend"
        prior.write_bytes(b"BLENDER previous")
        return script, prior

    def test_success_is_isolated_and_terminates_sandbox(self):
        sdk = self.sdk()
        with TemporaryDirectory() as tmp, patch(
            "modal_provider.artifact_validation.validate_python_outputs"
        ) as validate:
            script, _ = self.files(tmp)
            out = Path(tmp) / "out"
            result = run(sdk, out, python_file=str(script))
            self.assertEqual(result["status"], "PASS")
            self.assertTrue(result["sandbox_terminated"])
            self.assertEqual({a["name"] for a in result["artifacts"]}, set(ARTIFACT_NAMES))
            validate.assert_called_once_with(out.resolve())
            sdk.Image.from_registry.assert_called_once_with(
                self.image, add_python="3.11"
            )
            sdk.Image.from_dockerfile.assert_not_called()
            self.assertEqual(result["blender_image"], self.image)
            options = sdk.Sandbox.create.call_args.kwargs
            self.assertTrue(options["block_network"])
            self.assertEqual(options["timeout"], 900)
            self.assertNotIn("secrets", options)
            sdk.Sandbox.create.return_value.terminate.assert_called_once_with(wait=True)
            self.assertEqual(json.loads((out / "modal_run_report.json").read_text())["status"], "PASS")

    def test_create_invokes_only_python_blender_script(self):
        sdk = self.sdk()
        with TemporaryDirectory() as tmp, patch(
            "modal_provider.artifact_validation.validate_python_outputs"
        ):
            script, _ = self.files(tmp)
            run(sdk, Path(tmp) / "out", python_file=str(script))
            fs = sdk.Sandbox.create.return_value.filesystem
            fs.copy_from_local.assert_called_once_with(
                str(script.resolve()), "/workspace/out/model.py"
            )
            args = sdk.Sandbox.create.return_value.exec.call_args.args
            self.assertIn("apply_python.py", " ".join(args))
            self.assertIn("NEW", args)
            self.assertNotIn("run_smoke.sh", " ".join(args))

    def test_revision_uploads_verified_predecessor_before_python_execution(self):
        sdk = self.sdk()
        with TemporaryDirectory() as tmp, patch(
            "modal_provider.artifact_validation.validate_python_outputs"
        ):
            script, prior = self.files(tmp)
            report = run(sdk, Path(tmp) / "out", revision=2,
                         input_blend=str(prior), python_file=str(script))
            self.assertEqual(report["revision"], 2)
            calls = sdk.Sandbox.create.return_value.filesystem.copy_from_local.call_args_list
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[0].args, (str(script.resolve()), "/workspace/out/model.py"))
            self.assertEqual(calls[1].args, (str(prior.resolve()), "/workspace/out/input.blend"))
            args = sdk.Sandbox.create.return_value.exec.call_args.args
            self.assertIn("/workspace/out/input.blend", args)
            self.assertEqual(len(report["artifacts"]), 2)

    def test_glb_is_transferred_if_report_declares_optional_preview(self):
        sdk=self.sdk(preview=True)
        with TemporaryDirectory() as tmp, patch(
            "modal_provider.artifact_validation.validate_python_outputs"
        ):
            script,_=self.files(tmp)
            result=run(sdk,Path(tmp)/"out",python_file=str(script))
            self.assertEqual({a["name"] for a in result["artifacts"]},
                             {"scene.blend","scene.json","scene.glb"})
            self.assertEqual(result["preview_status"],"available")

    def test_missing_or_invalid_script_is_rejected_before_billing(self):
        sdk = self.sdk()
        with TemporaryDirectory() as tmp:
            script, _ = self.files(tmp)
            for source in ("", "  ", "x" * 65537, "print(1)\x00"):
                script.write_text(source)
                with self.assertRaises(ValueError):
                    run(sdk, Path(tmp) / "out", python_file=str(script))
            script.write_bytes(b"\xff\xfe")
            with self.assertRaisesRegex(ValueError, "UTF-8"):
                run(sdk, Path(tmp) / "out", python_file=str(script))
            with self.assertRaises(ValueError):
                run(sdk, Path(tmp) / "out")
            sdk.Sandbox.create.assert_not_called()

    def test_invalid_revision_source_never_allocates_sandbox(self):
        sdk = self.sdk()
        with TemporaryDirectory() as tmp:
            script, prior = self.files(tmp)
            with self.assertRaisesRegex(ValueError, "saved .blend"):
                run(sdk, Path(tmp) / "out", revision=2, python_file=str(script))
            with self.assertRaisesRegex(ValueError, "saved .blend"):
                run(sdk, Path(tmp) / "out", revision=2,
                    input_blend=str(Path(tmp) / "missing.blend"), python_file=str(script))
            with self.assertRaisesRegex(ValueError, "predecessor"):
                run(sdk, Path(tmp) / "out", revision=1,
                    input_blend=str(prior), python_file=str(script))
            with self.assertRaisesRegex(ValueError, "revision"):
                run(sdk, Path(tmp) / "out", revision=0, python_file=str(script))
            sdk.Sandbox.create.assert_not_called()

    def test_fake_sandbox_artifacts_are_rejected_even_with_success_marker(self):
        sdk = self.sdk()
        with TemporaryDirectory() as tmp:
            script, _ = self.files(tmp)
            with self.assertRaisesRegex(RunnerDiagnostic, "artifact_invalid"):
                run(sdk, Path(tmp) / "out", python_file=str(script))
            sdk.Sandbox.create.return_value.terminate.assert_called_once_with(wait=True)

    def test_unrelated_success_marker_is_rejected_for_creation_and_edit(self):
        for revision in (1, 2):
            sdk = self.sdk(marker="BW_SMOKE PASS")
            with TemporaryDirectory() as tmp:
                script, prior = self.files(tmp)
                out = Path(tmp) / "out"
                with self.assertRaisesRegex(RunnerDiagnostic, "blender_execution_failed"):
                    run(sdk, out, revision=revision, python_file=str(script),
                        input_blend=str(prior) if revision == 2 else None)
                sdk.Sandbox.create.return_value.terminate.assert_called_once_with(wait=True)
                report = json.loads((out / "modal_run_report.json").read_text())
                self.assertEqual(report["status"], "FAILED")
                self.assertEqual(report["artifacts"], [])

    def test_blender_failure_always_terminates(self):
        sdk = self.sdk(exit_code=1)
        with TemporaryDirectory() as tmp:
            script, _ = self.files(tmp)
            with self.assertRaisesRegex(RunnerDiagnostic, "blender_execution_failed"):
                run(sdk, Path(tmp) / "out", python_file=str(script))
            sdk.Sandbox.create.return_value.terminate.assert_called_once_with(wait=True)

    def test_copy_failure_always_terminates(self):
        sdk = self.sdk(copy_error=OSError("transport failure"))
        with TemporaryDirectory() as tmp:
            script, _ = self.files(tmp)
            with self.assertRaisesRegex(RunnerDiagnostic, "artifact_transfer_failed"):
                run(sdk, Path(tmp) / "out", python_file=str(script))
            sdk.Sandbox.create.return_value.terminate.assert_called_once_with(wait=True)

    def test_allocation_failure_reports_no_sandbox_to_terminate(self):
        sdk = self.sdk()
        sdk.Sandbox.create.side_effect = RuntimeError("quota")
        with TemporaryDirectory() as tmp:
            script, _ = self.files(tmp)
            with self.assertRaisesRegex(RunnerDiagnostic, "sandbox_start_failed"):
                run(sdk, Path(tmp) / "out", python_file=str(script))
            sdk.Sandbox.create.return_value.terminate.assert_not_called()

    def test_registry_ref_requires_release_sha_or_digest(self):
        good = "ghcr.io/erland/blender-workspace-blender:sha-" + "f" * 40
        digest = "ghcr.io/erland/blender-workspace-blender@sha256:" + "a" * 64
        release = "ghcr.io/erland/blender-workspace-blender:v1.2.3"
        self.assertEqual(blender_image_reference(release), release)
        self.assertEqual(blender_image_reference(good), good)
        self.assertEqual(blender_image_reference(digest), digest)
        for bad in ("", "latest", "ghcr.io/erland/blender-workspace-blender:latest",
                    "ghcr.io/erland/blender-workspace-blender:v1.2.3-rc.1",
                    "ghcr.io/erland/blender-workspace-blender:v1.2",
                    "ghcr.io/erland/blender-workspace-blender:v01.2.3",
                    "ghcr.io/erland/blender-workspace-blender:sha-abc",
                    "docker.io/erland/blender:sha-" + "a" * 40,
                    "ghcr.io/a/b:sha-" + "g" * 40,
                    "ghcr.io/erland/blender-workspace-blender:sha-" + "a"*40 + " --insecure"):
            with self.subTest(ref=bad), self.assertRaises(ValueError):
                blender_image_reference(bad)

    def test_missing_or_unpinned_registry_image_never_calls_modal(self):
        sdk = self.sdk()
        with TemporaryDirectory() as tmp:
            script, _ = self.files(tmp)
            for ref in ("", "ghcr.io/erland/blender-workspace-blender:latest"):
                with self.subTest(ref=ref), patch.dict(os.environ,
                    {"MODAL_BLENDER_IMAGE": ref}):
                    with self.assertRaises(RunnerDiagnostic) as raised:
                        run(sdk, Path(tmp) / "out", python_file=str(script))
                    self.assertEqual((raised.exception.phase, raised.exception.code),
                                     ("setup", "image_reference_invalid"))
            sdk.Image.from_registry.assert_not_called()
            sdk.Sandbox.create.assert_not_called()
            sdk.App.lookup.assert_not_called()

    def test_cost_estimate_and_artifact_contract(self):
        self.assertEqual(estimate_usd(60, 2, 8192), 0.007932)
        self.assertEqual(ARTIFACT_NAMES, ("scene.blend", "scene.json"))


if __name__ == "__main__":
    unittest.main()
