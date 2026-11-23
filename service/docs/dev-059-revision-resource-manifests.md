# DEV-059 – Immutable revision-to-resource binding

## Implemented in this step

Each saved revision may bind a bounded array of trusted, content-addressed
resources alongside the scene's existing artifact manifest. Resource objects
have exactly these fields:

```json
{"name":"resources/stone.png","sha256":"<64 lowercase hex>","sizeBytes":1234}
```

`name` is a **logical path**, not an absolute filesystem path or a URL.
Only safe relative names under `resources/` are permitted, and duplicates
(including case-insensitive duplicates) are rejected. The trusted artifact
store verifies every referenced SHA-256 blob before and immediately before
atomic revision publication. Missing/corrupt files fail the entire publish
before any revision directory becomes visible.

`LocalArtifactStore.verifiedRevisionResources(projectId,revision)`
reads the stored revision manifest and resolves only its exact verified
resources. It is an internal trusted API and does not grant authorization
to end users simply because they know a SHA-256 hash. Public routes must
still check their own owner/share scopes before invoking this helper.

Existing scene artifact handling stays unchanged. An omitted `resources`
field is equivalent to an empty array for untextured revisions. This is
necessary for the current untextured workflow, **not** a compatibility
promise for experimental textured revisions.

## Not enabled yet

This commit does **not** change how Blender creates scene files, how uploads
are converted to texture references, what Modal receives, how rendering works
or how public/private BLEND and project ZIPs are exported. The existing
worker still packs image textures into each BLEND revision. The new optional
manifest API is a prerequisite for the option-B pipeline, not activation of
external-resource-only Blender scenes.

This is an intentional safety barrier: turning off `pack_all` before the
worker and renderer can rematerialize resources would create unrenderable
revisions.

## Next step

Connect the Blender modeling worker, trusted Modal runner and render
orchestrator to this revision resource contract. On successful modeling,
publish blobs and bound manifest in a single fail-closed flow; restore the
same logical resources into each isolated modeling and rendering job.
Verify a real Blender render after deleting original upload files. Only then
switch off automatic embedding for new texture-bearing BLEND revisions.

A later, separate step will repackage resources for portable native download
and project backup/export. Resource garbage collection is deferred until
cross-revision and in-flight-job reference safety is verified.

## Verification

Node tests cover shared content identifiers across revisions, missing and
corrupted resource detection, rejected unsafe paths, duplicate logical
names, tampered JSON and existing untextured revision behavior.
All required GitHub CI checks must pass for the implementation SHA.
