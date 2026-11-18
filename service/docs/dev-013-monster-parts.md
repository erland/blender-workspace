# DEV-013 — Controlled editing of multiple monster parts

## Scope

The existing data-only `workspace_queue_scene_edit` MCP tool accepts seven **predefined mesh names** found in the original cube-monster scene: `Body`, `LeftLeg`, `RightLeg`, `LeftEye`, `RightEye`, `LeftPupil` and `RightPupil`. Each request edits exactly **one** named mesh and creates a new immutable project revision using the pre-existing owner-scoped dispatcher and Modal sandbox.

A new read-only MCP tool `workspace_list_editable_parts` returns the exact names and allowed properties, so ChatGPT can discover supported targets without inventing names.

The data contract remains `{target,color?,location?,scale?}`. `color` is RGB normalized to 0..1. `location` is an **absolute local object transform** with three coordinates from -10..10. `scale` is an **absolute local object scale** with three factors from 0.1..4. At least one property must be supplied. Previous DEV-012 Body-only edits remain valid; no database schema changes are needed.

## Security and behavior

- A fixed target allowlist is enforced in both TypeScript/Zod and Python before Modal allocation, and the Blender script accesses only the named mesh after validation.
- No arbitrary Blender Python, dynamic object lookup beyond the allowlist, script paths, other scene files or user-controlled functions.
- Color edits copy the material before modification; eyes and pupils or legs that shared materials can be recolored independently.
- The existing armature, animation and other meshes are preserved. This step does not edit bones, keyframes or mesh topology.
- Source revisions are verified against SHA-256 and remain immutable; ownership and optimistic revision locking are unchanged.
- The allowed part catalog describes **the generated demo monster**. It is not general scene introspection and will not work for arbitrary uploaded scenes.

## Verification

Automated tests validate the seven names and reject arbitrary targets, check read-only MCP part catalog and previous owner/isolation behavior, execute existing mocked Modal tests and PostgreSQL tests, and build the worker. Headless Blender smoke tests from earlier steps continue to run. A live per-user Modal operation and real Google/ChatGPT login remain deliberately deferred.
