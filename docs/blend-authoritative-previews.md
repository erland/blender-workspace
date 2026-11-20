# Authoritative Blender model and optional GLB preview

## Decision
A saved scene.blend is the authoritative asset. GLB is a derived real-time
preview and must not constrain use of Blender hair curves, Geometry Nodes,
Cycles materials, modifiers, simulation or advanced scene objects.

## Job contract
- Blender executes the approved Python script in the existing isolated sandbox.
- scene.blend is always saved before any attempt to create a GLB.
- Export of scene.glb is best effort and capped at 90 seconds within the sandbox. Failure or unusable GLB is recorded in
  scene.json (preview.status=unavailable, reason=export_failed), without leaking
  arbitrary exporter errors or failing an otherwise valid modeling revision.
- When GLB exists, preview.status=available and fidelity=unverified. This
  signifies a loadable GLB, never visual or feature parity with .blend.
- scene.blend and scene.json remain required and checksum-verified by trusted
  controller; GLB is validated and transferred only when present.
- Subsequent edits read the verified scene.blend, independent of GLB availability.
- The web portal checks stored manifests and offers GLB viewer links only when
  a GLB was actually stored. Native-only revisions stay inspectable via scene
  metadata and can be continued from Python.

## Rendered preview (separate step)
Add a separately queued, explicitly approved render action using an existing
revision's verified .blend. Render into PNG (Eevee / Cycles with bounded
resolution/samples/resources), publish as a separate optional visualization
artifact without creating a new model revision or running Python edits.
Re-use owner authentication, Modal connection, cost limits and artifact
integrity. Never render automatically for every model edit; render jobs cost
more than basic geometry inspection. Display stored images in the portal.

## Limits
The application still enforces conservative memory and artifact size bounds
inside isolated workers. Complex scenes may exceed those limits; such cases
should be diagnosed as resource limits, not GLB incompatibility. Preview
fidelity is not automatically measurable from a successful export.

## Acceptance
- Existing cube/cylinder still generates GLB and viewer link.
- Curve/hair-like native Blender scene may produce no GLB but completes and
  can be edited to a new revision using the original blend.
- Corrupted original blend or manifest remains a hard error.
- Browser never advertises a viewer link for a GLB-free revision.
- No additional Modal work is introduced by this change.
