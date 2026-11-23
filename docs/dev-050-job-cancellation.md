# DEV-050 — Safe model-job cancellation

## Scope
Only **modeling jobs** can be cancelled in this increment, using
`workspace_cancel_job({jobId})` or the owner-only `Avbryt jobb` form on the
job overview or project history. Rendering and GLB refresh are unchanged.

## State machine
- `pending → cancelled`: SQL-atomic, immediate; no Modal Sandbox was allocated.
- `running → cancelling`: durable intent, still holds the per-project revision
  lock. The dispatcher polls owner-scoped intent at most every two seconds.
- `cancelling → cancelled`: only when the trusted Modal controller reports
  `BW_CANCELLED` **after** confirmed Sandbox termination, or when the model
  controller completed normally and the trusted worker discarded results.
- `cancelling → needs_recovery`: uncertain cleanup, hard-stop or lost worker.
  This holds the revision lock and must not be represented as a successful stop.
- `completed / failed / cancelled / needs_recovery`: cancellation is idempotent
  and has no new side effects. No automatic retry.

## Execution
The Node worker sends SIGTERM to its owner-specific Python Modal controller
upon cancellation, then SIGKILL after 12 seconds if the controller has not
exited. Python installs a cancellation handler and runs its existing
`sandbox.terminate(wait=True)` cleanup in `finally`. Its short fixed
`BW_CANCELLED` marker is emitted only after a report proves a Sandbox was
created and its termination confirmed. Unknown provider state never becomes
a claimed success. The normal commit path rejects cancelling jobs.

The cancellation endpoint is authenticated (Google session + CSRF + Origin),
and the MCP tool requires write scope. Both delegate the database transition
through owner-scoped repository methods; neither launches Modal.

## Known constraints
- A Python SIGTERM that interrupts Modal allocation before a Sandbox
  identifier is known cannot establish provider termination. Such jobs remain
  `needs_recovery`, and may need inspection in Modal Dashboard.
- Cancellation request may race with a completed commit; the winning
  transaction determines status. Already committed revisions are preserved.
- Forced SIGKILL may leave an orphan Modal Sandbox. Never assume cost stops
  until provider termination is confirmed.
- The UI must display `cancelling` distinctly from `cancelled`.
- This feature does not terminate rendering or GLB refresh jobs.

## Verification
Node and PostgreSQL integration tests assert pending cancellation,
owner isolation, idempotency, active revision locks, late publish rejection,
and uncertain termination. Real owner-billed Modal interrupt remains a separate,
explicitly authorized acceptance check.
