# Modal/Blender failed-job diagnostics

## What the owner sees

`workspace_get_job({jobId})` remains an OAuth-protected, owner-scoped
read-only tool. For a job in `failed` or `needs_recovery`, it now
includes `failure: {phase,code}` (or `failure: {phase,code,reason}` for recognized artifact checks) when the database contains a
recognized safe diagnostic. Example:

```json
{"job":{"id":"...","status":"failed","requestedRevision":1},"failure":{"phase":"modal_start","code":"image_unavailable"}}
```

A missing `failure` field on an older job means diagnostic detail is
unavailable; it does not mean the run succeeded. The historical
`Modal worker exited 1` message cannot be reconstructed retroactively.

A `setup / image_reference_invalid` failure means the worker has no valid pinned\n`MODAL_BLENDER_IMAGE` configured. A `setup / modal_sdk_unavailable` failure\nmeans the Python controller cannot import the Modal SDK. Neither condition\nrequires starting a paid Sandbox. Direct execution of the controller now\nensures its package imports resolve, including on exception paths.\n\nPhases: `setup`, `modal_start`, `blender_execution`,
`artifact_transfer`, `artifact_validation`, `artifact_storage`,
`revision_commit`, `cleanup`.

Codes are restricted to a finite server-owned allowlist. In particular,
`image_unavailable` points to a Blender GHCR image availability or
pull issue; `sandbox_start_failed` to a Modal allocation issue;
`blender_execution_failed` to the isolated Blender process;
`artifact_transfer_failed` or `artifact_invalid` to artifact handling.
These are **classifications**, not complete low-level stack traces.

Since DEV-042, Blender starts with `--python-exit-code 1` so that a raised
Python exception leads to a nonzero process exit. Trusted Blender code emits
a strict `BW_USER_PYTHON_ERROR` marker containing only a recognized Python
exception **class** and the last line in the user script. The Modal
controller combines it with the process exit code, validates the fields and
returns `python_script_error`. The owner can see, for example:
```json
{"failure":{"phase":"blender_execution","code":"python_script_error",
  "exitCode":1,"exceptionType":"AttributeError","sourceLine":142}}
```
The web job history displays the same failure in Swedish. Other recognized
codes include `blender_crash`, `blender_timeout` and `out_of_memory`.
The latter requires explicit memory-exhaustion evidence; exit 137 or SIGKILL
on their own remain crash/unknown. Unknown older jobs stay generic.

The full traceback and Python exception message remain unexposed: either
can contain credentials, filesystem paths, input data and user source. The
controller never persists raw stdout/stderr in `modal_run_report.json`.

## Security design

- The worker captures a bounded 8 KiB tail of stderr and stdout from
  its Python subprocess, but does **not** log either stream, persist
  either stream, or expose arbitrary text to ChatGPT.
- The Python runner emits the strict `BW_DIAGNOSTIC phase=... code=...`
  line upon failure. Node validates both fields against a fixed allowlist.
  Unrecognized output results in a generic code.
- The database stores only normalized `BW_JOB_ERROR` phase/code and optional
  allowlisted process exit/exception class/user line metadata.
  Provider exceptions, Python source, paths and credential values are
  never copied into these messages.
- Historical free-form `error_message` entries are **not** returned
  through the MCP tool.
- `JobRepository.get` scopes both owner and project before the MCP
  handler returns any diagnostic. A different OAuth identity cannot
  read another user's job.

## Deployment and investigation

After merging this change, publish a fresh stable GitHub Release,
verify the matching GHCR image tags, and redeploy in Coolify. The
`mcp` and `job-worker` should be the matching release. PostgreSQL
table changes are not required: existing `bw_jobs.error_message`
is reused.

The first real failure after the deployment can be inspected with
`workspace_get_job` using that failure's job ID. Do **not**
automatically resubmit a failed or ambiguous billable Modal job.
First inspect the phase/code, public GHCR Blender package visibility
and matching release tag. A new explicit single-job acceptance test
can then be performed if needed, with the user's agreement to
possible Modal charges.

## More precise artifact diagnostics

Failed artifact checks now return a fixed `reason`, for example:
```json
{"failure":{"phase":"artifact_validation","code":"artifact_invalid","reason":"glb_meshes_missing"}}
```
The worker also writes one sanitized JSON log line with `event=blender_job_failed`,
`jobId`, `phase`, `code` and, when available, `reason`. These
fields contain no Python source, raw provider output, filesystem paths or credentials.

Reasons distinguish missing or irregular BLEND/GLB/report files,
invalid binary headers, malformed GLB structure, missing meshes or nodes,
report provenance/identity errors and checksum errors. Unclassified
validation failures use `artifact_unclassified` rather than raw exceptions.
Existing historical jobs do not gain details retroactively.

An `artifact_invalid` result should be investigated by reading
`workspace_get_job` after deploying *both* the updated MCP image and
matching job-worker image. No schema migration or automatic Modal retry
is required.

## Queue capability versus worker health

`workspace_status.blender_jobs_available` now reports whether the authenticated MCP
service is configured with both the job-queue dependencies (Modal account
manager and artifact store). It does **not** attest that the independent
Coolify job-worker is online, that a particular owner's Modal token works,
or that a Sandbox can start. `blender_jobs_availability_scope: "queue_only"`
and `worker_health: "not_checked"` make this explicit. Check owner-specific
`workspace_modal_status`, then the individual `workspace_get_job` for
execution progress and errors. A queued or running job need not have a
committed revision or published artifacts yet.
