"""Start a short-lived Blender Sandbox, transfer artifacts, and terminate it."""
import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
import time


def _sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024*1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

ROOT = Path(__file__).resolve().parents[1]
# Executing runner.py directly sets sys.path[0] to modal_provider/, not
# necessarily the repository root. Preserve package imports in every failure path.
if __package__ in (None, "") and str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
ARTIFACT_NAMES = ("scene.blend", "scene.json")  # required; GLB is optional
CPU_RATE = 0.00003942  # Modal Sandbox USD per second, physical core
RAM_RATE = 0.00000667  # Modal Sandbox USD per GiB-second

# Accept pinned release versions, legacy commit tags, or digests; never mutable latest for paid Modal jobs.
GHCR_BLENDER_REF = re.compile(
    r"^ghcr\.io/[a-z0-9][a-z0-9_.-]*/[a-z0-9][a-z0-9_.-]*"
    r"(?::(?:sha-[0-9a-f]{40}|v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))|@sha256:[0-9a-f]{64})$"
)


def blender_image_reference(value=None):
    ref = value if value is not None else os.environ.get("MODAL_BLENDER_IMAGE", "")
    if not GHCR_BLENDER_REF.fullmatch(ref):
        raise ValueError("MODAL_BLENDER_IMAGE must be a pinned GHCR release version, sha-commit tag or sha256 digest")
    return ref



class RunnerDiagnostic(Exception):
    """Structured non-secret failure diagnostic for the trusted Node worker."""
    def __init__(self, phase, code, reason=None):
        super().__init__(code)
        self.phase, self.code, self.reason = phase, code, reason


def safe_failure_code(phase, error):
    # These checks classify known SDK failures without echoing any exception
    # message, traceback, Python source, token or filesystem path.
    kind = type(error).__name__.lower()
    # SDK exception class is sometimes generic (RemoteError). Inspect only for
    # classification; the underlying message is never emitted or persisted.
    detail = str(error).lower()[:2000]
    if phase == "modal_start":
        if ("auth" in kind or "permission" in kind or "unauthorized" in kind or
                "permission denied" in detail or "unauthorized" in detail or
                "invalid token" in detail):
            return "authentication_failed"
        if ("image" in kind or "notfound" in kind or
                "manifest unknown" in detail or "image not found" in detail or
                "pull access denied" in detail):
            return "image_unavailable"
        return "sandbox_start_failed"
    return {
        "blender_execution": "blender_execution_failed",
        "artifact_transfer": "artifact_transfer_failed",
        "artifact_validation": "artifact_invalid",
        "cleanup": "sandbox_cleanup_failed",
    }.get(phase, "initialization_failed")


def estimate_usd(seconds, cpu=2, memory_mib=8192):
    return round(seconds * (cpu * CPU_RATE + memory_mib / 1024 * RAM_RATE), 6)


def run(sdk, out_dir, *, cpu=2, memory_mib=8192, timeout=900,
        revision=1, input_blend=None, python_file=None,
        assets_manifest=None, asset_files=None):
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
    if not 1 <= len(raw) <= 65536 or b'\x00' in raw or not raw.strip():
        raise ValueError('Invalid Python source length or content')
    try:
        raw.decode('utf8')
    except UnicodeDecodeError as exc:
        raise ValueError('Python source must be UTF-8') from exc
    asset_files = list(asset_files or [])
    if len(asset_files)>4 or bool(asset_files)!=bool(assets_manifest):
        raise ValueError('Invalid model sources')
    if asset_files:
        manifest_path=Path(assets_manifest)
        if manifest_path.is_symlink() or not manifest_path.is_file() or manifest_path.stat().st_size>4096:
            raise ValueError('Invalid source manifest')
        manifest=json.loads(manifest_path.read_text(encoding='utf8'))
        if not isinstance(manifest,list) or len(manifest)!=len(asset_files):
            raise ValueError('Invalid source manifest entries')
        for i,(entry,filename) in enumerate(zip(manifest,asset_files)):
            source=Path(filename)
            if (not source.is_file() or source.is_symlink() or
                source.stat().st_size<20 or source.stat().st_size>256*1024*1024 or
                not isinstance(entry,dict) or set(entry)!={'index','offset','format'} or
                entry['format'] not in ('blend','glb') or
                (entry['format']=='blend' and source.open('rb').read(7)!=b'BLENDER') or
                (entry['format']=='glb' and source.open('rb').read(4)!=b'glTF') or
                entry['index']!=i or not isinstance(entry['offset'],list) or
                len(entry['offset'])!=3 or
                any(type(x) not in (int,float) or not -100000<=x<=100000 for x in entry['offset'])):
                raise ValueError('Unsafe model source')
    # Validate the pinned image before any chargeable Modal API call.
    try:
        image_ref = blender_image_reference()
    except ValueError:
        raise RunnerDiagnostic("setup", "image_reference_invalid") from None
    out = Path(out_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    sandbox = None
    report = {"schema_version": 1, "revision": revision, "provider": "modal-sandbox",
              "cpu_physical_cores": cpu, "memory_mib": memory_mib,
              "sandbox_timeout_seconds": timeout, "status": "FAILED", "artifacts": [],
              "blender_image": image_ref}
    phase = "modal_start"
    try:
        image = sdk.Image.from_registry(image_ref, add_python="3.11")
        app = sdk.App.lookup("blender-workspace-dev002", create_if_missing=True)
        sandbox = sdk.Sandbox.create(
            "sleep", str(timeout), app=app, image=image, cpu=cpu, memory=memory_mib,
            timeout=timeout, workdir="/workspace", block_network=True)
        created = time.monotonic()
        sandbox.filesystem.copy_from_local(str(python_source), "/workspace/out/model.py")
        if revision >= 2:
            sandbox.filesystem.copy_from_local(str(Path(input_blend).resolve()),
                "/workspace/out/input.blend")
        if asset_files:
            sandbox.filesystem.copy_from_local(str(Path(assets_manifest).resolve()),
                '/workspace/out/asset-sources.json')
            for i,(filename,entry) in enumerate(zip(asset_files,manifest)):
                sandbox.filesystem.copy_from_local(str(Path(filename).resolve()),
                    '/workspace/out/source-%02d.%s' % (i,entry['format']))
        phase = "blender_execution"
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
        phase = "artifact_transfer"
        # Always transfer the native project and inspection report first.
        # Preview presence is determined by the report, not a mandatory GLB.
        for name in ARTIFACT_NAMES:
            local = out / name
            sandbox.filesystem.copy_to_local("/workspace/out/" + name, str(local))
            if not local.is_file() or local.stat().st_size == 0:
                raise RuntimeError(f"Artifact missing or empty: {name}")
            report["artifacts"].append({
                "name": name, "bytes": local.stat().st_size,
                "sha256": _sha256_file(local)})
        metadata=json.loads((out / "scene.json").read_text(encoding="utf8"))
        entries=metadata.get("artifacts",[])
        if isinstance(entries,list) and any(
                isinstance(item,dict) and item.get("path")=="scene.glb" for item in entries):
            local=out / "scene.glb"
            sandbox.filesystem.copy_to_local("/workspace/out/scene.glb",str(local))
            if not local.is_file() or not local.stat().st_size:
                raise RuntimeError("Optional preview declared but missing")
            report["artifacts"].append({
                "name":"scene.glb","bytes":local.stat().st_size,
                "sha256":_sha256_file(local)})
        report["preview_status"]=metadata.get("preview",{}).get("status","unknown")
        phase = "artifact_validation"
        from modal_provider.artifact_validation import validate_python_outputs
        validate_python_outputs(out)
        report["sandbox_start_seconds"] = round(created - started, 3)
        report["blender_execution_seconds"] = round(executed - created, 3)
        report["artifact_transfer_seconds"] = round(time.monotonic() - executed, 3)
        report["status"] = "PASS"
        return report
    except Exception as exc:
        code = safe_failure_code(phase, exc)
        # A fixed, non-secret detail identifies the exact failed validation check.
        from modal_provider.artifact_validation import ArtifactValidationError
        reason = exc.reason if phase == 'artifact_validation' and isinstance(exc, ArtifactValidationError) else None
        report["failure_phase"] = phase
        report["failure_code"] = code
        if reason is not None:
            report["failure_reason"] = reason
        raise RunnerDiagnostic(phase, code, reason) from None
    finally:
        if sandbox is not None:
            try:
                sandbox.terminate(wait=True)
                report["sandbox_terminated"] = True
            except Exception as exc:
                report["sandbox_terminated"] = False
                report["termination_error_code"] = "sandbox_cleanup_failed"
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
    p.add_argument("--assets-manifest")
    p.add_argument("--asset-file", action="append", default=[])
    p.add_argument("--timeout", type=int, default=900)
    p.add_argument("--cpu", type=float, default=2)
    p.add_argument("--memory-mib", type=int, default=8192)
    args = p.parse_args()
    if not 30 <= args.timeout <= 1800:
        p.error("timeout must be 30-1800 seconds")
    if not 0.125 <= args.cpu <= 4 or not 512 <= args.memory_mib <= 16384:
        p.error("resource limit exceeded")
    try:
        try:
            import modal
        except ImportError:
            raise RunnerDiagnostic("setup", "modal_sdk_unavailable") from None
        report = run(modal, args.out, cpu=args.cpu, memory_mib=args.memory_mib,
                     timeout=args.timeout, revision=args.revision, input_blend=args.input_blend,
                     python_file=args.python_file,
                     assets_manifest=args.assets_manifest,asset_files=args.asset_file)
        if report["status"] != "PASS" or not report["sandbox_terminated"]:
            raise RunnerDiagnostic("cleanup", "sandbox_cleanup_failed")
    except RunnerDiagnostic as exc:
        detail = f" reason={exc.reason}" if exc.reason else ""
        print(f"BW_DIAGNOSTIC phase={exc.phase} code={exc.code}{detail}", file=sys.stderr)
        raise SystemExit(1) from None
    except Exception:
        # No raw SDK exception text or traceback in subprocess output.
        print("BW_DIAGNOSTIC phase=setup code=initialization_failed", file=sys.stderr)
        raise SystemExit(1) from None
    print("Modal artifacts saved to", args.out)


if __name__ == "__main__":
    main()
