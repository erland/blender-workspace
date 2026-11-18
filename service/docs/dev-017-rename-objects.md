# DEV-017 – Rename objects in generic Blender scenes

The existing MCP operation tool `workspace_queue_scene_operation` supports
`rename_object` for safely changing a scene object's name in an existing
revision, or after creating it within a 1–20 operation batch.

```json
{"kind":"batch","operations":[
  {"kind":"add_primitive","name":"Cylinder","primitive":"cylinder"},
  {"kind":"rename_object","name":"Cylinder","newName":"Table leg"},
  {"kind":"set_color","name":"Table leg","color":[0.2,0.4,0.6]}
]}
```

Both source and destination names must be nonempty, no longer than 100
characters, and contain no slashes or control characters. The new name must
differ from the original and must not be occupied by any scene object. The
operation preserves the object, mesh, materials, transform and relationships;
it does not clone geometry. Subsequent batch operations may refer to the new
name. Existing owner isolation, stale-revision protection, SHA verification
and immutable revision storage remain unchanged.

The MCP TypeScript schema and independent Python validator reject missing,
unknown or unsafe fields, and the Blender executor checks source existence
and destination collisions before changing a scene object. A failed batch
does not publish a new immutable scene revision.

Verification covers schema rejects and real headless Blender two-revision
create/duplicate/rename/edit with scene manifest assertions. Live
Google/ChatGPT acceptance and per-user billed Modal execution remain
intentionally deferred.
