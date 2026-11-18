# Technical decision spike: Modal Function vs Modal Sandbox for Blender Workspace

**Status:** reproducible benchmark implemented and local headless Blender CI
added. **No real Modal run, latency or billed costs have been measured.**
This is an opt-in experiment, not a production migration.

## Goal and fairness

Run the **same** `tests/blender_modal_benchmark.py` through the exact same
`experiments/Dockerfile.modal-benchmark` image, with 2 requested physical cores, 4 GiB memory, no GPU,
blocked outbound networking, no secrets/volumes, and a 180-second job timeout:

- **Function:** one ephemeral call, `single_use_containers=True`,
  `block_network=True`, `restrict_modal_access=True`.
- **Sandbox:** one new Sandbox per call, `block_network=True`, no secrets,
  explicit termination in `finally`.

The workload creates 42 beveled/ordinary cells and a PBR sphere (43 meshes),
exports GLB, and reports polygon counts, object count, GLB bytes and seconds
spent inside the Blender script. The same geometry signature must be returned
by both modes, otherwise the benchmark fails.

Runs are alternating Function/Sandbox and Sandbox/Function, with one
additional image-cache warm-up for each mode. Median total client wall-clock
time and Blender time are reported. The difference is **not a pure startup
metric**: it also includes network transport, subprocess startup, Python and
Blender initialization. Cold-start and concurrency measurements need a
separate experiment.

## Preferred execution: manual GitHub Actions run

After merging this PR into `main`:

1. Open **GitHub → Actions → Modal Function vs Sandbox benchmark → Run workflow**.
2. Select the `main` branch. Check **Start billable Modal jobs** (`run_modal: true`).
3. Choose the number of measured iterations (recommended **3**; range 1–5).
4. Run the workflow. The regular validation job runs first, then the paid
   comparison. Read the Action **Summary** and download
   `modal-function-vs-sandbox-results` under **Artifacts**.

Before starting, create a GitHub Actions environment named
`modal-benchmark` in the repository settings, preferably protected with
required reviewers, and configure these **environment secrets**:
`MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` for a dedicated Modal token
with minimal workspace permissions. Do not paste tokens into workflow
inputs, commit them to the repository, or expose them in logs. The environment
approval is optional but recommended as a second barrier against accidental
billable runs. If secrets are missing, the paid job fails safely.

**Safety:** On pull requests the workflow only validates syntax, dry-run
and local Blender. A manual dispatch with `run_modal=false` also performs
only local validation. **Only** a confirmed manual dispatch with
`run_modal=true` launches paid Modal jobs. The workflow has read-only GitHub
permissions, a 35-minute job timeout and a concurrency lock. There are no
GitHub actions that auto-run the paid job on merge. The Modal cost estimate
does not impose a hard spend cap: configure a budget in the Modal account.

Note that **GitHub requires a workflow_dispatch workflow to exist on the
default branch** before it can be started from the standard Actions UI.
Therefore merge the PR first. A run using an approved GitHub environment
will pause until the configured reviewer approves.

## Alternative: local execution (requires user's own authenticated Modal account)

From the repository root:

```bash
python3 -m pip install 'modal>=1.6,<2'
modal token set
python3 experiments/modal_function_vs_sandbox.py --iterations 3
# Cloud execution requires explicit opt-in:
python3 experiments/modal_function_vs_sandbox.py --execute --iterations 3 \
  --output modal-benchmark-results.json
```

Dry-run does not launch Modal. The second command **does incur Modal charges**,
including warm-up invocations and image build. Limit spend in Modal workspace
settings first. The benchmark produces one local JSON file with raw results,
median measurements and illustrative list-price estimates. The file should
be reviewed without including credentials before publication.

The test is intentionally not run by GitHub Actions with credentials.
CI only runs static compilation, dry-run and the identical Blender workload
in a local Docker container.

## Verified Modal prices (USD, November 2026)

| Requested resources | Function list estimate / minute | Sandbox list estimate / minute |
| --- | ---: | ---: |
| 2 CPU cores + 4 GiB memory | $0.002105 | $0.006331 |

Prices: CPU $0.00001310 vs $0.00003942 per core-second; memory
$0.00000222 vs $0.00000667 per GiB-second.
See https://modal.com/pricing . This comparison assumes fully reserved
2-core/4-GiB usage for every charged second, not observed utilization.
Actual billed CPU/memory vary, especially with Sandbox bursting, and may
not equal these estimates. GPU, build, storage and warm-up costs are separate.

## Security and trust boundaries

Modal states both its Function and Sandbox infrastructure use gVisor. It is
therefore **incorrect** to say Sandbox is uniquely protected by gVisor.
The main distinction is the **permission model and intended code trust**.
Modal Functions are meant for application-controlled code and normally have
broader workspace privileges; modern Functions can set
`restrict_modal_access=True` and `block_network=True`. Sandboxes are
intended to execute untrusted or agent-generated code and do not have
workspace privileges by default, with blockable egress.

Neither option makes AI-generated Python harmless. Both could destroy
their own temporary work files, run indefinitely without timeouts or try
to exploit software bugs. Production-safe AI Python also needs:

1. A trusted controller that holds the user's Modal credentials and
   never injects them into the code-execution environment.
2. A fresh ephemeral execution environment for each untrusted job,
   strict time, CPU, memory, disk and output-size limits.
3. No network, no secrets, no shared project mounts. Copy only a
   sanitized single-scene working file into the sandbox.
4. Validate produced BLEND, GLB, manifest and checksums in trusted code
   **outside the untrusted process** before atomic publishing.
5. Owner/revision checks and cost budgets enforced by Blender Workspace.

Running the fixed benchmark script is a performance validation, **not** a
penetration test of sandbox isolation, a proof that importing untrusted BLEND
is safe, or an evaluation of customer credential isolation.

Documentation:
- https://modal.com/docs/guide/sandbox-networking
- https://modal.com/docs/sdk/py/latest/App
- https://modal.com/docs/sdk/py/latest/Sandbox
- https://modal.com/docs/guide/sandbox-v2

## Decision criteria

Do not choose solely by the 3x unit cost. After 3–5 measured calls per
mode, use:
- Full client wall-clock time, median and range.
- Blender execution time to distinguish runtime overhead.
- Actual Modal billing / compute usage (including warmups and image build).
- Sandbox lifecycle reliability, timeout behavior and crash logs.
- Security policy feasibility: no secrets, no network, no shared mounts,
  and isolation from other users' projects.
- Multi-user authorization and per-owner account credentials in the
  *trusted control plane*, never in generated Python.

**Conditional recommendation:** Retain Functions for bounded trusted
operations because they are already integrated and lower list-price.
Use dedicated short-lived Sandboxes if later enabling unrestricted
AI-generated Blender Python. No wholesale migration is justified by the
currently verified evidence, and the hybrid decision still depends on
real Modal benchmark measurements and an end-to-end security test.

## Correction after manual Action #44392148551

The first paid benchmark attempt failed **before any measured run** when
Modal could not detect a supported Python interpreter in the original
Debian-based `Dockerfile`. This is not a user-token or Sandbox failure.

The comparison now uses a **benchmark-only Dockerfile** derived from the
production Blender image, but based on `python:3.12-slim-bookworm` so
`python` and `pip` are always on PATH. The production Dockerfile and
execution architecture are **unchanged**. Both benchmark modes use the
same derived image, so their relative measurements remain comparable.
GitHub Actions pins Python 3.12 in both validation and paid jobs and
locally checks `python`, `pip` and real Blender inside the benchmark
image before permitting a manual Modal test. The Sandbox branch also reads
its actual `returncode` after `wait()` for SDK compatibility.

This addresses the specific failure seen in run #44392148551, but a fresh
paid manual Action after merge is still required to verify Modal function
registration and the subsequent Sandbox test end to end.
