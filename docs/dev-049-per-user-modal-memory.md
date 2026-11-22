# DEV-049 — Per-user Modal Sandbox memory reservation

Default reserved memory is **2 GiB (2048 MiB)** instead of 8 GiB.
The same selection is used for every future Sandbox created for an owner:
Python modeling (including inline Cycles), separate Cycles/Eevee rendering
(including viewer camera renders), and GLB preview refresh.

Each authenticated owner can choose **2, 4, 8 or 16 GiB** in the
Google-protected **Modal-inställningar** page or through the scoped MCP tools
`workspace_get_modal_memory` (workspace:read) and
`workspace_set_modal_memory(memoryMiB)` (workspace:write).
Browser writes require the established signed session, CSRF token, same-origin
policy and explicit form submission.

Preferences are saved separately per owner in
`bw_modal_memory_settings` and survive a Modal credential disconnect;
they do not reveal or change connected tokens. The worker retrieves each
owner's setting **when the job starts** — changes can affect queued jobs
that have not started yet, but never an already running Sandbox.

If no owner has saved a preference, 2048 MiB is used. Requests are validated
against the same allowlist in TypeScript, Python CLI and DB. The current
CPU reservation remains two physical CPU cores. No GPU is requested.

Modal memory reservations are not guaranteed hard usage ceilings. Runtime
may use more when capacity is available, with varying cost and OOM risk.
Setting 2 GiB is an experiment based on low observed usage of small
Blender jobs, **not** a guarantee for large procedural scenes. Owners should
select 4/8/16 GiB for heavier jobs as needed. Any computed cost estimate
must reflect the job's actual requested memory and does not replace Modal
invoicing.

No real Modal job is launched in CI. Acceptance after deploying the worker:
view a small project's new Sandbox in Modal and confirm it requests 2 GiB;
change the owner setting to 4 GiB, start another explicitly authorized paid
job and verify the new request. Monitor memory, wall-clock time and failures.
