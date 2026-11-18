# DEV-012 — Structured scene edits

The new `workspace_queue_scene_edit` MCP operation takes `projectId`, `expectedRevision` and a strict data-only edit for the existing `Body` mesh. Supported optional properties are normalized RGB `color` in 0..1, `location` in -10..10, and `scale` in 0.1..4. At least one property is required; unknown keys, code and unrecognized target names are rejected.

The edit is validated using Zod, stored atomically as JSONB with the reserved job, validated again by the worker, serialized as JSON (not Python code), transferred to Modal alongside the SHA-256-verified source `.blend`, and validated again inside a fixed trusted Blender script. No dynamic Blender scripts, arbitrary file paths or user-controlled Python commands are accepted. Revision 2+ can build on the most recent saved revision. Earlier immutable revisions remain intact. Existing fixed blue revision-2 jobs remain supported.

The job owner comes exclusively from verified authentication and PostgreSQL metadata. A connected per-owner Modal account is required in the configured multi-user mode. An active job per project is protected by a unique index and optimistic revision checks.

The `location` and `scale` parameters are **absolute transforms of the Body object**, not deltas. This operation does not yet allow edits to other objects, topology, rigs, animation curves, materials shared with other objects, or arbitrary natural-language editing. The assistant may translate a user's request into structured allowed values but must not invent unsupported changes.

Tests exercise JSON validation, ownership, stale revisions, immutable artifact history, tamper rejection, simulated Modal transfer and sandbox lifecycle. A real personal Modal run and Google/ChatGPT external login remain deferred.
