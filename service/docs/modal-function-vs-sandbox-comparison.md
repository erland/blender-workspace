# Technical decision spike: Modal Function vs Modal Sandbox for Blender Workspace

**Status:** reproducible benchmark implemented and local headless Blender CI
added. **No real Modal run, latency or billed costs have been measured.**
This is an opt-in experiment, not a production migration.

## Goal and fairness

Run the **same** `tests/blender_modal_benchmark.py` through the exact same
`Dockerfile` image, with 2 requested physical cores, 4 GiB memory, no GPU,
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

## Running (requires user's own authenticated Modal account)

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
