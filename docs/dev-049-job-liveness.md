# DEV-049 — Live job supervision and safe recovery

This change is limited to **monitoring and timeout/recovery**. Interactive cancellation is a separate development step.

## Model job signals

`workspace_get_job` returns the existing status, plus (when available):
- `startedAt`: time claimed by a dispatcher
- `workerHeartbeatAt`: 15-second lease renewals from the Node job worker
- `lastBlenderPhaseAt`: last verified Blender-side heartbeat sampled via Modal
- `phase`: one of preparing, modal_start, blender_execution, artifact_transfer,
  artifact_validation, artifact_storage or revision_commit
- `deadlineAt`: fixed 19-minute execution deadline from claiming the job

These clocks are **not interchangeable**. A living Node controller does not prove
Blender is processing instructions. A Blender-side heartbeat is best-effort:
the trusted Blender process writes a non-sensitive numeric marker every 15 seconds;
the trusted Modal controller samples it at most once every 15 seconds. Native C
operations can block Python scheduling, and file transfer can fail; missing
heartbeats are not proof of failure. The MCP payload does not contain stdout,
stderr, source code, file paths, credentials or free-form provider errors.

## Timeout and recovery

Modal Sandbox limits modeling execution to 900 seconds; the Node controller is
killed at 18 minutes; a DB deadline is recorded at 19 minutes as a final safety
net. A separate worker watchdog runs every 15 seconds, including while the
dispatcher awaits Blender. It changes stale or deadline-expired running jobs to
`needs_recovery` **without** launching new Modal work or claiming to have
terminated an active Sandbox. A running lease older than 30 minutes without
renewal is stale. Recovery checks verified published artifacts explicitly.

Normal execution cannot commit from `needs_recovery`, or after its deadline.
Only the explicit verified-artifact recovery path can finalize a quarantined
job. Heartbeats are conditional on `status='running'`; a delayed marker cannot
revive a terminal job.

## Operational considerations

- The new schema migration `099_job_liveness.sql` adds nullable timestamps
  and a bounded phase, preserving older records.
- Use matching MCP and job-worker images and apply the migration before deploying.
- A failed/disconnected job-worker cannot itself enforce the watchdog; the
  Modal Sandbox timeout remains the independent execution limit.
- A status of `needs_recovery` is *ambiguous*, not a confirmation that a
  user-billed Modal Sandbox was terminated. Never automatically resubmit.
- Renderer and preview jobs retain their existing deadlines; extending this
  monitoring contract to them is a separate scoped task.
- Cancellation via MCP/web is deliberately **not** implemented here.
