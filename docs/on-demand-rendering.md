# On-demand rendered PNG previews

This capability is **separate from creating/editing Blender model revisions**.

## User-visible behavior

In the web portal, open a project and use **Rendera bild från Blender**.
Choose a saved revision, Eevee or Cycles, square output 256/512/1024,
and 8/16/32 samples. Clicking **Starta rendering i Modal** explicitly queues
a separately billed job using the user's personal connected Modal account.

From ChatGPT, call `workspace_queue_render` only after an explicit
render request. Check progress via `workspace_get_render`, which returns a
Google-authenticated browser link to the resulting PNG when complete.

Rendering reads only the SHA-256-verified original scene.blend from the
selected revision. It does **not** create a new model revision, change
the original Blender file, overwrite GLB, or execute a model edit script.

## Project page and index image galleries

Saved PNG renderings are shared across the project page and GLB viewer
regardless of whether they were requested from the project form or viewer.
Project details show clickable thumbnails grouped by revision; the home
page shows up to three most recent completed renderings per project,
across revisions. Both link to the same owner-protected PNG endpoint.
Neither display triggers a Modal or Blender job. Older projects without
renderings continue to show the existing abstract illustration.

The project home and detail pages explicitly permit same-origin images
in their Content Security Policy; scripts and remote images remain blocked.
The project description is existing persisted metadata and may be edited
(or cleared) from the project page, independently of renaming, with
owner-scoped authorization, same-origin/CSRF checks, a 5000-character
limit and HTML escaping. No migration is required.

## DEV-039: Render current GLB viewer camera

The browser viewer offers **Rendera aktuell vy (Modal)** after a model is loaded.
The operation requires an explicit confirmation before queuing a chargeable
Cycles CPU render under the signed-in owner's connected Modal account.

- Uses the same saved source `.blend`, render job journal, PNG artifact store
  and project-page image history as renders started on the project page.
- Uses 16 Cycles samples with denoising. The **shortest image edge is 512 px**;
  the longer edge follows the canvas aspect ratio, up to 2048 px (4:1 limit).
- The viewer sends a bounded perspective camera position, orbit target,
  camera up direction and vertical field of view. Its glTF/Three.js Y-up
  world coordinates are transformed to Blender's Z-up coordinates. The
  existing scene camera is overridden only in Blender memory, not in `.blend`.
- The selected revision's three latest saved PNGs appear below the viewer,
  with an expandable history and a link to the project's full history.
  Active render statuses refresh at ten-second intervals; reading the
  history never calls Modal.
- The viewer endpoints require the existing signed Google browser session;
  the POST also requires same-origin checking, a CSRF token and active Modal
  connection. The token is fetched by an owner-scoped history request and
  never appears in the static viewer HTML.
- Existing project-page and MCP render requests remain square and retain
  their prior options. Viewer-only camera renders are stored with
  `requested_from='viewer'` and validated `camera_override` JSON.
- A local headless Blender/Cycles smoke test verifies camera rendering and
  non-square output without a paid Modal job. Visual fidelity, realistic hair
  and running Cycles against a real user-funded Modal Sandbox still require
  explicit live acceptance testing.

## Cost/resource policy

- **Never render automatically** when a model is created or modified.
- Owner-billed Modal Sandbox uses two physical CPU cores, 8 GiB RAM,
  a 360-second sandbox limit and a 7-minute worker watchdog.
- Square output is at most 1024 x 1024 and samples at most 32 for Cycles,
  with a fixed allowlist of engine, size and sample choices.
- Only one active render per project is permitted. The queue prioritizes
  modeling jobs.
- Canceled, timed-out, disconnected or crashed jobs are **not retried
  automatically**; doing so could charge the user twice.
- Completed PNG files are SHA-256 verified and linked to the job journal.
  Images can be viewed without starting Blender or Modal again.
- If a worker crashes after storing a PNG but before marking completion,
  use `node dist/jobs/cli.js render-recover OWNER JOB_ID` within the worker
  to verify and finalize metadata without a new Modal job. Investigate
  jobs in `needs_recovery` with no PNG manually.
- The original model revision and GLB remain untouched.

## Security and fidelity

Render only inside the isolated, network-blocked Modal Sandbox using a
fixed trusted Blender Python script. Blender loads the saved scene with
script auto-execution disabled. Never put Modal credentials in URLs or in
rendered images. Browser forms use the signed Google session, owner scope,
same-origin checks and CSRF. PNG downloads are also owner checked.

If the scene has no camera, the render worker creates a temporary fallback
camera and a light in memory (not written back into the original .blend).
Cycles is CPU-based; Eevee may require graphics support from the pinned
Blender image and can fail on headless hosts. Failed renders do not affect
the source model.

## Artifact lifecycle

Stored at `<ARTIFACT_ROOT>/<project UUID>/renders/<render-job UUID>.png`
with the checksum and size in `bw_render_jobs`. Render output is a *derived*
preview, not part of the immutable revision manifest and currently **not
included** in `.bwproject.zip` export/import. Reimporting a project preserves
its models and revisions but not previously rendered images.

Permanent project deletion blocks pending/running/recovery render jobs and
removes completed PNGs, render records, source Blender files and revision
history together.

## Acceptance test (no paid run needed for CI)

Verify input validation, owner isolation, CSRF/origin rules, PostgreSQL
reservation conflict and deletion block, valid saved PNG retrieval, render
job completed status, unchanged source revision count, and recovery without
calling Modal. A single explicitly approved real Modal run with Cycles and a
hair/curves scene is a follow-up live test, not part of CI.
