# DEV-041 — Secure external BLEND/GLB import

## Workflow
Open **Importera 3D-modell** in the signed-in browser portal. Upload a native
`.blend` or embedded `.glb` file (20 bytes to 32 MiB); no Modal usage occurs.
Afterward choose a destination: a new project or an existing scene. Confirm the
additional Modal charge explicitly; one Python-first job with `code: "pass"`
imports the model and publishes the next immutable revision. Reuse an uploaded
asset later from the file list or through MCP.

MCP `workspace_list_uploaded_models` returns owner-only file metadata.
Use `workspace_queue_python_script` with
`assetSources:[{"uploadId":"ASSET_UUID","offset":[0,0,0]}]` to compose
an uploaded asset. Each job supports up to four combined sources, mixing saved
project revisions and uploaded models.

## Security and limits
- Google signed session, exact origin (Safari same-origin exception), CSRF on
  upload and separate cost-confirmed enqueue endpoint. Files are not remotely
  downloaded and never use caller-controlled server paths.
- Validate file extension, native BLENDER header or binary GLB structure.
  GLB references to external images/buffers are rejected. OBJ and ZIP are not
  accepted by this flow.
- Files are private, ID-addressed, immutable and SHA-256 verified on source
  retrieval. Owner checks are repeated when queueing and immediately before
  sending any files to a paid network-blocked Modal Sandbox.
- Upload is buffered by Fastify with an explicit 32 MiB body limit; max four
  imported assets per modeling job. A file may require further processing in
  Blender; header validation is not a guarantee that Blender can load it.
- Native BLEND imports preserve Blender objects and referenced materials,
  armatures and animation datablocks. GLB import uses Blender's glTF importer
  for meshes, materials, rigging and supported animation data. Foreign cameras,
  lights and speakers are not automatically added to the target scene.
- Immutable source files remain unchanged; output is another revision of the
  destination project. No paid Modal job is run during CI.

## Boundaries
Uploaded assets remain stored for reuse, independent of source project
deletion; a library-management/delete UI, larger uploads and OBJ are deferred.
CI tests format rejection, authorization, integrity, source staging and actual
Blender composition from both formats. Live deployment requires separate
acceptance with real owner accounts and Modal execution.
