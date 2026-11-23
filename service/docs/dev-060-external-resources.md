# DEV-060 – External texture restoration across Blender and Modal

## New modeling contract

Blender Workspace now externalizes **ordinary FILE image textures in PNG/JPEG**
from the native BLEND. After user Python and the existing portable pack pass,
the Blender worker extracts verified image bytes to `resources/<sha256>.<ext>`
and changes image filepaths to `//resources/<sha256>.<ext>`, relative to the
saved BLEND. Identical image bytes share one content-addressed object in the
server's private volume. Untextured models work as before.

Non-PNG/JPEG packed resources remain embedded in BLEND for now; generated
procedural textures need no external file. If a required resource is missing
or the portability audit is inconclusive, the worker rejects the revision
instead of publishing a file that could render incorrectly later.

The untrusted Blender worker lists generated files only by relative, content-
named resource descriptors. The trusted Modal controller independently checks
each generated file's name, size and SHA-256 before transferring it back.
The Node orchestrator then deduplicates those verified bytes in
`ContentAddressedResourceStore` and commits the immutable revision with the
same exact resource descriptors. No partially published revision is visible.

## Modeling and rendering

Before an owner-billed Modal operation, the server resolves each referenced
resource through the selected revision's verified manifest. The trusted Python
controller independently rechecks all bytes before starting Modal, then
populates the isolated worker's `/workspace/out/resources/` tree. Blender
opens `/workspace/out/input.blend` and resolves `//resources/...` without
accessing user paths or the network.

Model composition from another revision that has external resources is
temporarily rejected *before billing*: mapping several independent BLEND files'
relative resource roots requires a separate namespaced composition step.
Existing composition of untextured/fully packed models still works.

## Export safety

**Do not claim that a raw BLEND or project ZIP is portable if its revision
depends on external resource objects.** Until the next export step:

- Private native download returns a conflict for external-resource revisions.
- Public native download cannot be enabled for such revisions, and requests
  to an existing link fail closed.
- Project ZIP backup/export rejects projects containing such revisions.
- GLB previews and remote renders remain available because the GLB is
  self-contained and render jobs restore the referenced resources.

Next change: shared portable native BLEND/ZIP packaging for both authenticated
and public users, plus project export/import with unique resources included
only once. **Do not delete** content-addressed resources until cross-revision
reference counting, active-job protection and garbage-collection tests exist.

## Verification

- Python tests verify transfer manifests, safe names, checksum mismatches and
  sandbox destination paths.
- Real Blender CI reloads an externalized texture after deleting its original
  upload, and confirms no packed image copy remains inside the native BLEND.
- Service/PostgreSQL CI verifies application and revision contracts.
- Deployment CI validates the service images.

Live Modal rendering and browser acceptance are deferred to a controlled
manual test; no paid Modal sandbox is started by CI.
