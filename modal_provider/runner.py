"""Start a short-lived Blender Sandbox, transfer artifacts, and terminate it."""
import argparse
import hashlib
import json
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_NAMES = ("monster_v1.blend", "monster_v1.glb", "monster_v1.json",
                  "monster_v2.blend", "monster_v2.glb", "monster_v2.json")
CPU_RATE = 0.00003942  # Modal Sandbox USD per second, physical core
RAM_RATE = 0.00000667  # Modal Sandbox USD per GiB-second


def estimate_usd(seconds, cpu=2, memory_mib=8192):
    return round(seconds * (cpu * CPU_RATE + memory_mib / 1024 * RAM_RATE), 6)


def run(sdk, out_dir, *, cpu=2, memory_mib=8192, timeout=900,
        revision=1, input_blend=None, edit_file=None, operation_file=None, python_file=None):
    """Injected SDK makes error and cleanup paths unit-testable without billing."""
    if not 1 <= revision <= 99999999 or (revision > 2 and not (edit_file or operation_file or python_file)):
        raise ValueError('Invalid or unsupported revision')
    if revision >= 2 and (not input_blend or not Path(input_blend).is_file()):
        raise ValueError("A saved .blend file is required for revision 2")
    if revision == 1 and (input_blend is not None or edit_file is not None):
        raise ValueError("Creation must not receive previous scene data")
    if python_file is not None:
        if operation_file is not None or edit_file is not None:
            raise ValueError('Python source cannot mix with structured operations')
        python_source=Path(python_file).resolve()
        if not python_source.is_file():
            raise ValueError('Python source file missing')
        raw=python_source.read_bytes()
        if not 1<=len(raw)<=16384 or b'\\x00' in raw or not raw.strip():
            raise ValueError('Invalid Python source length or content')
    if operation_file is not None:
        from blender_workspace_poc.scene_operation_validation import validate_operation
        if edit_file is not None:raise ValueError('Cannot mix operation types')
        op_path=Path(operation_file).resolve()
        if not op_path.is_file():raise ValueError('Operation file missing')
        operation=validate_operation(json.loads(op_path.read_text('utf8')))
        first=(operation['operations'][0] if operation['kind']=='batch' else operation)
        if revision==1 and first['kind'] not in ('add_primitive','add_mesh','import_glb'):
            raise ValueError('Initial scene requires primitive')
    if edit_file is not None:
        from blender_workspace_poc.scene_edit_validation import validate_edit
        if revision < 2:
            raise ValueError("Edit requires an existing scene")
        edit_path = Path(edit_file).resolve()
        if not edit_path.is_file():
            raise ValueError("Edit file missing")
        validate_edit(json.loads(edit_path.read_text(encoding="utf-8")))
    out = Path(out_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    image = sdk.Image.from_dockerfile(str(ROOT / "Dockerfile"), context_dir=str(ROOT))
    app = sdk.App.lookup("blender-workspace-dev002", create_if_missing=True)
    started = time.monotonic()
    sandbox = None
    report = {"schema_version": 1, "revision": revision, "provider": "modal-sandbox",
              "cpu_physical_cores": cpu, "memory_mib": memory_mib,
              "sandbox_timeout_seconds": timeout, "status": "FAILED", "artifacts": []}
    try:
        sandbox = sdk.Sandbox.create(
            "sleep", str(timeout), app=app, image=image, cpu=cpu, memory=memory_mib,
            timeout=timeout, workdir="/workspace", block_network=True)
        created = time.monotonic()
        if python_file is not None:
            sandbox.filesystem.copy_from_local(str(Path(python_file).resolve()),
                "/workspace/out/model.py")
            if revision>=2:
                sandbox.filesystem.copy_from_local(str(Path(input_blend).resolve()),
                    "/workspace/out/input.blend")
            process=sandbox.exec("blender","-b","--factory-startup","--python",
                "/workspace/blender_workspace_poc/apply_python.py","--",
                "NEW" if revision==1 else "/workspace/out/input.blend",
                "/workspace/out/model.py",str(revision))
        elif operation_file is not None:
            sandbox.filesystem.copy_from_local(str(Path(operation_file).resolve()),
                "/workspace/out/operation.json")
            if revision>=2:
                sandbox.filesystem.copy_from_local(str(Path(input_blend).resolve()),
                    "/workspace/out/input.blend")
            process=sandbox.exec("blender","-b","--factory-startup","--python",
                "/workspace/blender_workspace_poc/apply_operation.py","--",
                "NEW" if revision==1 else "/workspace/out/input.blend",
                "/workspace/out/operation.json",str(revision))
        elif revision >= 2:
            sandbox.filesystem.copy_from_local(str(Path(input_blend).resolve()),
                f"/workspace/out/monster_v{revision-1}.blend")
            if edit_file is not None:
                sandbox.filesystem.copy_from_local(str(Path(edit_file).resolve()),
                    "/workspace/out/scene_edit.json")
                process = sandbox.exec(
                    "blender", "-b", "--factory-startup", "--python",
                    "/workspace/blender_workspace_poc/edit_scene.py", "--",
                    f"/workspace/out/monster_v{revision-1}.blend",
                    "/workspace/out/scene_edit.json", str(revision))
            else:
                process = sandbox.exec(
                    "blender", "-b", "--factory-startup", "--python",
                    "/workspace/blender_workspace_poc/revise_monster.py")
        else:
            process = sandbox.exec("bash", "/workspace/scripts/run_smoke.sh")
        code = process.wait()
        report["blender_stdout_tail"] = process.stdout.read()[-8000:]
        report["blender_stderr_tail"] = process.stderr.read()[-4000:]
        if code != 0:
            raise RuntimeError(f"Blender smoke failed: exit code {code}")
        if revision == 1 and operation_file is None and "BW_SMOKE PASS" not in report["blender_stdout_tail"]:
            raise RuntimeError("Expected Blender smoke success marker missing")
        executed = time.monotonic()
        names = (('scene.blend','scene.glb','scene.json') if (operation_file is not None or python_file is not None) else
                 ARTIFACT_NAMES if revision == 1 else
                 tuple(f'monster_v{revision}.{ext}' for ext in ('blend','glb','json')))
        for name in names:
            local = out / name
            sandbox.filesystem.copy_to_local("/workspace/out/" + name, str(local))
            if not local.is_file() or local.stat().st_size == 0:
                raise RuntimeError(f"Artifact missing or empty: {name}")
            report["artifacts"].append({
                "name": name, "bytes": local.stat().st_size,
                "sha256": hashlib.sha256(local.read_bytes()).hexdigest()})
        if python_file is not None:
            from modal_provider.artifact_validation import validate_python_outputs
            validate_python_outputs(out)
        report["sandbox_start_seconds"] = round(created - started, 3)
        report["blender_execution_seconds"] = round(executed - created, 3)
        report["artifact_transfer_seconds"] = round(time.monotonic() - executed, 3)
        report["status"] = "PASS"
        return report
    except Exception as exc:
        report["error_type"] = type(exc).__name__
        report["error"] = str(exc)[:1000]
        raise
    finally:
        if sandbox is not None:
            try:
                sandbox.terminate(wait=True)
                report["sandbox_terminated"] = True
            except Exception as exc:
                report["sandbox_terminated"] = False
                report["termination_error"] = str(exc)[:1000]
                report["status"] = "FAILED"
        else:
            report["sandbox_terminated"] = True  # no sandbox was allocated
        report["elapsed_seconds"] = round(time.monotonic() - started, 3)
        report["estimated_sandbox_compute_usd"] = estimate_usd(
            report["elapsed_seconds"], cpu, memory_mib)
        report["cost_note"] = (
            "Estimate, not actual invoice; excludes image build, storage and network transfer.")
        (out / "modal_run_report.json").write_text(json.dumps(report, indent=2) + "\n")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="out-modal")
    p.add_argument("--revision", type=int, default=1)
    p.add_argument("--input-blend")
    p.add_argument("--edit-file")
    p.add_argument("--operation-file")
    p.add_argument("--python-file")
    p.add_argument("--timeout", type=int, default=900)
    p.add_argument("--cpu", type=float, default=2)
    p.add_argument("--memory-mib", type=int, default=8192)
    args = p.parse_args()
    if not 30 <= args.timeout <= 1800:
        p.error("timeout must be 30-1800 seconds")
    if not 0.125 <= args.cpu <= 4 or not 512 <= args.memory_mib <= 16384:
        p.error("resource limit exceeded")
    import modal
    report = run(modal, args.out, cpu=args.cpu, memory_mib=args.memory_mib,
                 timeout=args.timeout, revision=args.revision, input_blend=args.input_blend,
                 edit_file=args.edit_file,operation_file=args.operation_file,
                 python_file=args.python_file)
    if report["status"] != "PASS" or not report["sandbox_terminated"]:
        raise RuntimeError("Sandbox cleanup or verification failed")
    print("Modal artifacts saved to", args.out)


if __name__ == "__main__":
    main()
