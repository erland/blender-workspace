# DEV-028 – Import of small, self-contained GLB models

The final planned functional area of phase B is importing third-party GLB
assets into the versioned Blender Workspace model.

## First bounded implementation

The MCP scene operation `import_glb` accepts a **complete base64-encoded,
self-contained GLB v2** in `glbBase64` and a required `name` prefix.
It can be the first operation of a new scene or an edit to an existing scene.

```json
{
  "kind": "import_glb",
  "name": "ImportedPart",
  "glbBase64": "<base64 representation of a complete GLB v2 file>"
}
```

The model's source file is never fetched from a network URL and its file path
is not accepted from an MCP request. The already authenticated and
owner-scoped normal scene operation job transports the validated JSON to
Blender. The worker decodes the GLB into a private temporary file under its
fixed output directory and removes the temporary file after import. It then
prefixes imported object names, assigns **fresh stable UUIDs** to every
imported object (never trusts identities embedded by third parties), and
writes the normal immutable BLEND, GLB and scene report.

Imported mesh objects can be renamed, transformed, recolored, parented,
duplicated, assigned PBR materials and modified with the operations added
during DEV-022 through DEV-027.

## Limitations and defensive boundaries

- Maximum 120,000 decoded GLB bytes / 160,000 base64 characters. The service
  has a 256-KiB MCP HTTP request limit. This *first import channel is for
  small assets*, not typical large model downloads.
- GLB v2 only: no .gltf sidecars, ZIPs, external images, external buffer URIs,
  HTTP URLs or local path references.
- Preflight validates GLB header/chunks, embedded scene structure and accessor
  bounds independently in TypeScript and Python.
- Imported scene must contain geometry, with at most 256 objects (128 meshes),
  up to 100,000 combined mesh vertices and 50,000 polygons after import.
- A failed import stops the new job; no partial scene revision is published.
- Blender is still an external file parser. Real-world untrusted GLB parsing
  must run in the existing isolated job runtime with CPU/memory/time limits.
  Input bounds alone do not prove that arbitrary files are safe.

**Not yet implemented:** user-friendly direct browser file upload, larger
assets, shared asset libraries, import by URL or cross-project asset
references. These require an owner-bound staged upload protocol, a file
scanner and a job-to-artifact reference that does not expose file paths.
We should not call that production import channel complete until this is
designed and tested.

## Verification

Python and TypeScript tests cover valid bounded GLB, malformed base64,
size and accessor limits, unknown fields and remote resource rejection.
The headless Blender regression reimports a previously generated custom
GLB into a new scene, checks new object IDs, edits an imported object in
revision two and verifies the saved BLEND and GLB outputs.

Google/ChatGPT, personal Modal and iPad/browser end-to-end acceptance
remain deferred. After this PR, **phase B's bounded modeling foundation
is implemented**, but external asset upload and live acceptance remain
explicit outstanding work, not silently marked done.
