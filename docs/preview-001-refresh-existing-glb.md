# PREVIEW-001 - Regenerate a GLB without changing the native model

## User flow
1. After migration `010_glb_preview_refresh.sql` and deployment of both MCP
   service and job worker, call `workspace_queue_glb_preview_refresh` with
   owned `projectId` and `revision`. **This starts an additional charged
   Modal Sandbox job** and must be explicitly requested.
2. Poll `workspace_get_glb_preview_refresh` using `previewJobId`.
3. When complete, reopen the normal viewer URL for the same revision. It will
   serve the latest owner-verified, checksum-verified derived GLB.
4. On failure, the original immutable GLB remains available, unless the
   latest completed derived preview exists but has corrupted bytes (fail closed).
5. The source `scene.blend`, existing `scene.glb`, `scene.json` and
   immutable revision manifest are **never overwritten**. No new revision.

## Infrastructure and safety
- Requires SQL migration and latest worker image. Existing pending jobs are
  claimed using SKIP LOCKED, owner-bound Modal credentials and an isolated
  network-disabled Blender Sandbox. No arbitrary model-editing Python executes.
- Run `blender -b --disable-autoexec` and export the saved file with the
  MAT-001 material fallback, with a 360-second sandbox timeout and 8 GiB RAM.
- Per-job outputs are stored under `<project>/glb-previews/<job-uuid>.glb`.
  Verify file bytes using SHA-256 and 128 MiB maximum.
- Stale running jobs are quarantined, not automatically billed twice.
  Authorized operator recovery: `preview-recover OWNER JOB_ID`, which uses
  already published bytes without restarting the billed job.
- Project deletion removes its derived preview directory through the existing
  project-directory delete. Project archive v1 exports **source revisions only**;
  refreshed previews are disposable and regenerated after import if needed.

## Acceptance
- Re-export a procedural olive material and verify non-white GLB baseColor.
- Original BLEND SHA-256 unchanged.
- Owner scope, read and write scope, and no duplicate active jobs.
- Source revision count unchanged after completed export.
- Existing native GLB and browser viewer remain functional.
