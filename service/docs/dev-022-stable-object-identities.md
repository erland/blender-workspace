# DEV-022 – Stable object identities across Blender revisions and GLB

Every object in a newly saved generic scene receives the custom property
`bw_object_id` containing a lowercase UUID v4. The same UUID is:

- Persisted in the authoritative `scene.blend` object custom properties.
- Included in `scene.json` as `scene.objects[].objectId`.
- Exported to the relevant glTF node's `extras.bw_object_id` inside `scene.glb`
  (with the Blender exporter option `export_extras=True`).

The browser GLB raycaster reads node `userData.bw_object_id` populated from
glTF extras and copies it along with the project/revision and object name
when a user selects an object. The ID survives `rename_object`,
`set_transform` and `set_color`. `duplicate_object` assigns the new
object a fresh UUID rather than inheriting its source object's custom
property. Deleting an object removes its identity; an unrelated new object
does not reuse it.

## Backward compatibility

When saving an older BLEND file, objects lacking a valid UUID receive one
during the next **normal model modification and save**, with no separate
Modal job. Duplicated/malformed IDs are repaired deterministically by
visiting objects in name order. Previously saved immutable BLEND/GLB
revisions are not modified. The existing scene JSON parser still accepts
older reports without `objectId`, and older GLB selections fall back to
their exported names with an explicit "missing stable ID" label.

## Limitations

This is an identity foundation, not yet an id-based operation target or a
complete parenting/grouping feature. The current MCP operation contract still
addresses objects by Blender name. Extending operations to accept IDs and
adding safe parenting/hierarchy edits should be a separate, reviewed step.
Some imported or legacy externally produced glTF data may not carry our
custom property. The ID should only be trusted as a scene-local reference;
authorization remains strictly enforced by the project/revision API.

## Verification

Unit tests cover new assignments, rename-preserving semantics, malformed
IDs, duplicate-ID repair and independent duplicated objects. Existing CI
includes real headless Blender creation, edited revision and GLB export,
with new assertions for UUID persistence across revisions and correct
`extras.bw_object_id` in the GLB JSON chunk. Production Google/ChatGPT,
iPad browser selection, and user-billed Modal execution remain deferred.
