# DEV-023 – UUID-targeted Blender operations and object hierarchy

This step extends the bounded JSON scene-operation contract without allowing
Python scripts, arbitrary paths, or extra Modal invocations outside normal edits.

## Selectors

For operations `set_transform`, `set_color`, `rename_object`,
`delete_object` and `set_parent`, supply **exactly one** of:

- `"name": "Current Blender name"` (backward compatible)
- `"objectId": "lowercase-uuid-v4"` (stable across renamed revisions)

For `duplicate_object`, `name` is the **new** object's name, and supply
exactly one of `source` (existing source name) or `sourceId` (source UUID).
Duplicated objects receive fresh UUIDs. Malformed, missing, or ambiguous
IDs fail closed. All IDs refer only to the currently owned scene revision
selected by the job; they do not provide cross-project access.

## Hierarchies

The new safe operation is:

```json
{"kind":"set_parent","objectId":"<child-uuid>","parentId":"<parent-uuid>"}
```

Use `"parentId": null` to remove an existing parent relationship.
The child can alternatively be selected using `"name"`. The operation
rejects missing parents, parenting to self, or introducing an ancestor cycle.
World transform is preserved on parenting/unparenting by saving and restoring
the Blender `matrix_world` property. Subsequent transformations use the
scene's existing local transform semantics.

A batch of 1–20 operations executes in order. New objects receive an ID
before the following operation, and an older BLEND scene has IDs backfilled
before any ID-addressed operations. This is compatible with DEV-022 and
existing name-addressed automation. Parenting changes are saved in BLEND
and exposed as `scene.objects[].parent` in the scene report.

## Limits

This is not a general mesh editor, an object/group UI, or nested batch
language. Existing scene edits remain revision-based, owner-isolated and
validated. Parent selection is **UUID-only** to avoid stale-name ambiguity.
Cycle rejection is checked in Blender, not inferred from request JSON.
Live Google/ChatGPT/Modal and iPad acceptance remain deferred.

CI covers TypeScript and Python schema validation and real headless Blender
revision creation, stable UUID targeting, parenting, rename and hierarchy
information persistence.
