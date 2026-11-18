# DEV-010 – Automatic queued Blender job dispatch

DEV-010 adds a **separate continuously running job-worker process**. The MCP request reserves a pending job and returns immediately. The dispatcher discovers it through PostgreSQL, atomically claims it with `FOR UPDATE SKIP LOCKED`, and runs the pre-existing DEV-006 orchestration with **the authenticated project owner's personal Modal credentials** from DEV-009.

## Deployment on Coolify

Build with `job-worker/Dockerfile`, context the repository root, as an independent worker service (no public HTTP port). Set the container command to `dispatch` (image ENTRYPOINT is `node dist/jobs/cli.js`). Deploy it separately from the MCP HTTP app. Both containers need access to the same private PostgreSQL database and persistent artifact volume.

Set secrets for the dispatcher: `DATABASE_URL`, `ARTIFACT_ROOT`, `MODAL_WORKER_ROOT=/app`, and `MODAL_CREDENTIAL_ENCRYPTION_KEY` (same 32-byte encryption key as the MCP service). Optional `MODAL_DISPATCH_POLL_MS` (default 2000, allowed 250–60000), `MODAL_STALE_JOB_MINUTES` (default 30, allowed 20–10080). The worker container includes Python and Modal SDK, and needs outbound access to Modal. Store no static Modal token in the dispatcher or app.

**Never enable `MODAL_EXECUTION_MODE=legacy` for the dispatcher**. Startup fails when that setting is present, or when the per-user credential key is missing.

Example (use equivalent Coolify settings, not a publicly exposed command):

```sh
docker run --rm --network trusted --env-file /secure/worker.env \
  -v /persistent/blender-artifacts:/data/blender-workspace \
  blender-workspace-worker:dev010 dispatch
```

The dispatcher processes one job at a time per replica. Additional replicas may run concurrently: PostgreSQL guarantees a pending job can only be claimed once; the existing one-active-job-per-project index remains enforced. Keep initial deployment to one replica. Queueing a new demo requires a connected personal Modal account; jobs for disconnected/revoked owners are skipped until an account is reconnected.

## Recovery and safety

All Blender operations are **bounded** by the existing runner timeout (Modal sandbox 900 s, worker 1080 s). On SIGTERM/SIGINT the dispatcher stops polling and finishes its current job. Give the container a shutdown grace period sufficient for one job.

If the worker process crashes while the job is `running`, the dispatcher marks it `needs_recovery` after the stale threshold, **not** `pending`. It will not re-run the task automatically: a previous Modal sandbox might have completed and incurred cost. An operator must inspect the saved revision and use the existing `recover OWNER JOB_ID` command when verified artifacts exist. If artifacts are missing, do not replay until the operator confirms the original execution and billing state; the row intentionally blocks the project until resolved.

Logs and MCP responses never include personal Modal token secrets. The dispatcher does not accept owner or command input from unauthenticated network requests. The database job provides the authenticated owner identity; Modal credentials are loaded server-side only for that owner.

**Limitations:** Only the fixed first-revision cube-monster demo is supported. There is no general scene-modification prompt yet. This process has no public start/stop API, retries or DLQ UI, and no distributed heartbeat. The 30-minute quarantine threshold exceeds the expected maximum run time; deployments must maintain these timeout assumptions. Real Google login and real per-owner Modal execution/billing remain deferred acceptance checks. Do not claim DEV-008/009 external verification PASS.

## CI acceptance

`dispatcher-dev010.yml` executes real PostgreSQL claims, parallel dispatcher tests, owner-isolation tests, disconnected-owner handling, failure/replay rejection, stale-job quarantine, graceful shutdown, regression tests, and builds the Docker worker. No billable Modal sandbox runs.
