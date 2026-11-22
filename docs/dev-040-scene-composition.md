# DEV-040 — Compose saved Blender models into one scene

An existing `workspace_queue_python_script` job accepts optional
`assetSources`, at most four saved BLEND source revisions owned by the same
authenticated account. The destination revision remains protected by the usual
`expectedRevision` optimistic lock. This is **one** explicitly requested,
owner-billed Modal job; no automatic retry is scheduled.

Example, creating a new scene from two saved projects:

```json
{
 "projectId":"DESTINATION_UUID","expectedRevision":0,
 "code":"pass",
 "assetSources":[
  {"projectId":"REX_PROJECT_UUID","revision":6,"offset":[-4,0,0]},
  {"projectId":"CAT_PROJECT_UUID","revision":2,"offset":[4,0,0]}
 ]
}
```

For an existing scene, set `expectedRevision` to its latest revision and
provide one or more sources. Each source is imported as a separate Blender
collection with original object/rig/material data and fresh Blender Workspace
object identities. Cameras, lights and speakers from imported source projects
are omitted; the destination scene retains its existing lighting/cameras.
The regular Python script then runs and can refine placement or scene details.
`pass` performs composition without additional modifications.

Security: source references are only UUID+revision+bounded offset; the caller
cannot submit paths or URLs. Database reservation verifies source ownership,
artifact existence and no duplicate project+revision; the worker rechecks
owner and verifies the native BLEND SHA-256, before receiving user Modal tokens.
Modal transfers sources to fixed `/workspace/out/assets/source-NN.blend`
paths, with no network access or secrets in the sandbox.

The native source and target revisions are unchanged. The new revision is
published using the existing immutable artifact store. Source provenance
is retained on `bw_jobs.asset_sources`; collection custom props retain the
source index, not the user's internal storage locations. Sources are
**snapshots**, so later changes to original projects do not propagate.

This does not provide external file upload or GLB import (DEV-041).
OBJ remains excluded.
