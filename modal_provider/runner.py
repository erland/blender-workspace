"""Start a short-lived Blender Sandbox, transfer artifacts, and terminate it."""
import argparse
import hashlib
import json
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_NAMES = ("scene.blend", "scene.glb", "scene.json")
CPU_RATE = 0.00003942  # Modal Sandbox USD per second, physical core
RAM_RATE = 0.00000667  # Modal Sandbox USD per GiB-second


def estimate_usd(seconds, cpu=2, memory_mib=8192):
    return round(seconds * (cpu * CPU_RATE + memory_mib / 1024 * RAM_RATE), 6)


def run(sdk, out_dir, *, cpu=2, memory_mib=8192, timeout=900,
        revision=1, input_blend=None, python_file=None):
    """Run only a validated Python script inside an owner-billed isolated Sandbox."""
    if not 1 <= revision <= 99999999:
        raise ValueError('Invalid Python scene revision')
    if revision == 1 and input_blend is not None:
        raise ValueError('Initial scene must not receive a predecessor')
    if revision >= 2 and (not input_blend or not Path(input_blend).is_file()):
        raise ValueError('A saved .blend file is required for a revision')
    if python_file is None:
        raise ValueError('Python source file is required')
    python_source = Path(python_file).resolve()
    if not python_source.is_file() or python_source.is_symlink():
        raise ValueError('Python source file missing or unsafe')
    raw = python_source.read_bytes()
    if not 1 <= len(raw) <= 16384 or b'\x00' in raw or not raw.strip():
        raise ValueError('Invalid Python source length or content')
    try:
        raw.decode('utf8')
    except UnicodeDecodeError as exc:
        raise ValueError('Python source must be UTF-8') from exc
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
        sandbox.filesystem.copy_from_local(str(python_source), "/workspace/out/model.py")
        if revision >= 2:
            sandbox.filesystem.copy_from_local(str(Path(input_blend).resolve()),
                "/workspace/out/input.blend")
        process = sandbox.exec("blender", "-b", "--factory-startup", "--python",
            "/workspace/blender_workspace_poc/apply_python.py", "--",
            "NEW" if revision == 1 else "/workspace/out/input.blend",
            "/workspace/out/model.py", str(revision))
        code = process.wait()
        report["blender_stdout_tail"] = process.stdout.read()[-8000:]
        report["blender_stderr_tail"] = process.stderr.read()[-4000:]
        if code != 0:
            raise RuntimeError(f"Blender smoke failed: exit code {code}")
        if "BW_SANDBOX_PYTHON PASS" not in report["blender_stdout_tail"]:
            raise RuntimeError("Expected isolated Blender-Python success marker missing")
        executed = time.monotonic()
        names = ARTIFACT_NAMES
        for name in names:
            local = out / name
            sandbox.filesystem.copy_to_local("/workspace/out/" + name, str(local))
            if not local.is_file() or local.stat().st_size == 0:
                raise RuntimeError(f"Artifact missing or empty: {name}")
            report["artifacts"].append({
                "name": name, "bytes": local.stat().st_size,
                "sha256": hashlib.sha256(local.read_bytes()).hexdigest()})
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
    p.add_argument("--python-file", required=True)
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
                 python_file=args.python_file)
    if report["status"] != "PASS" or not report["sandbox_terminated"]:
        raise RuntimeError("Sandbox cleanup or verification failed")
    print("Modal artifacts saved to", args.out)


if __name__ == "__main__":
    main()
