# DEV-046 – All renders use the same gallery and render store

An inline Cycles image is created **inside the modeling Blender process**,
exactly as in DEV-045. There is no second Modal job.

After the native revision has been committed, the trusted worker copies its
checksum-verified `scene.png` into the **existing RenderArtifactStore** under
a deterministic render ID (the modeling job UUID) and registers it as a normal
completed `bw_render_jobs` record. It uses engine CYCLES, 512×512 and 16
samples with the standard project render category. The original `scene.png`
remains in the immutable revision for provenance, ZIP export/import and
recovery; it does not require a special gallery path.

Therefore the existing project card, project image gallery, image endpoint,
GLB viewer render-history API, and GLB viewer client all discover the image
through the same DB query and URL shape as separately queued renders.

## Isolation and recovery

The model job is finalized **before** derived render registration. A failed
copy or DB insert must not mark the native model job failed and cannot trigger
additional paid work. The immutable image can be registered later without
rendering again.

At dispatcher startup, at most 100 most-recent completed inline model jobs
lacking a corresponding render record are considered for no-Modal
reconciliation. Missing optional PNGs are skipped. A manual
`inline-render-recover OWNER MODEL_JOB_ID` worker CLI command can be used
for an older job without running Blender. Registration is idempotent and
checks completed job ownership, model revision and explicit inline option.

## Verification

Node/Postgres integration tests ensure the render appears in ordinary
render listings, preserves owner authorization, registers only once and
survives a synthetic post-model storage failure with no-Modal recovery.
The real Blender/CI tests from DEV-045 remain unchanged.

Live acceptance: after deployment, inspect the already created DEV-045
revision in GLB viewer. No paid Modal rerun is required.
