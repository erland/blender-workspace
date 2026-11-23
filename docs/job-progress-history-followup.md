# Job progress and history — follow-up to DEV-050

This step is a **read-only UI and history improvement**. It introduces no paid
Modal work, no new job state, and no cancellation or timeout changes.

## Source of truth
The already persisted fields `started_at`, `finished_at`,
`worker_heartbeat_at`, `blender_heartbeat_at`, `progress_phase`,
`deadline_at`, and `cancellation_requested_at` are now selected by the
owner-scoped historical job query. Both the /jobs overview and each project's
history view display the available values. MCP `workspace_get_job` already
exposes them individually.

## Rendering
- Known phase names map to a finite Swedish label list, not raw source strings.
- Active modeling jobs show phase, elapsed wall-clock time, remaining deadline,
  and **separate** worker/Blender heartbeat recency.
- A worker heartbeat proves only that the Node worker updated its lease; it
  does not prove Blender is making progress.
- The Blender heartbeat is sampled on a best-effort basis and may be absent
  during long C/Blender operations; the UI says "ingen färsk signal" after
  60 seconds rather than claiming the process died.
- No percentages or completion estimates are fabricated.
- Archived model jobs show only their last known phase and total elapsed
  time, labeled historical. Older records without timestamps render normally.
- Render jobs do not display fictional Blender modeling phase information.

## Verification
Unit tests cover real phase metadata, separate signal age, historical
behavior, unknown phases, missing legacy data, no invented progress percentage,
and both UI contexts. A PostgreSQL-backed integration test verifies owner
isolation and the persisted fields in the list query.

The existing live-status client already refreshes only bounded, server-rendered
regions; no new browser polling route, token handling, or script is required.

**Naming note:** This documentation uses the conversational DEV-051 step name.
The repository already contains a separate DEV-051 for viewer video export.
Consider choosing a distinct ticket identifier when updating the roadmap.
