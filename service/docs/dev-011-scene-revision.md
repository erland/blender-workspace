# DEV-011 – Revisions from saved Blender scenes

The first supported editing operation is intentionally narrow: reopen revision 1 of the existing rigged cube-monster, recolor its body blue, and save revision 2. This builds on the pre-existing, Blender-verified `blender_workspace_poc/revise_monster.py` rather than executing user-supplied Blender scripts.

## Workflow

1. User creates a project and queues `workspace_queue_demo`; dispatcher/Modal saves immutable `monster_v1.blend`, `monster_v1.glb` and `monster_v1.json`.
2. User calls `workspace_queue_recolor_blue(projectId)`, with optional note. This is available **only when project's current revision is 1 and a saved, registered source revision exists**. The authenticated owner is derived from OAuth, never supplied by the caller. Queueing still requires a connected personal Modal account in configured production mode.
3. PostgreSQL atomically reserves one `pending` job for expected revision 1, requested revision 2. Any concurrent job or stale revision is rejected.
4. The independent dispatcher claims the job, verifies the source `.blend` against its immutable artifact manifest including SHA-256, and passes it through Modal Sandbox `filesystem.copy_from_local` to `/workspace/out/monster_v1.blend`.
5. In the sandbox, headless Blender opens the prior scene with `bpy.ops.wm.open_mainfile`, changes `Monster_Green` to blue while retaining armature/WalkCycle, and saves `monster_v2.blend`, `monster_v2.glb` and a v2 report.
6. The worker publishes a new immutable revision and finalizes PostgreSQL metadata. Revision 1 is never overwritten.

## Safety and limits

Only the predetermined blue recolor is supported. There is **no arbitrary generated Python execution**, unrestricted scene modification, free-form prompt interpretation, upload of arbitrary Blender scenes, additional colors or revision 3+ support. A separate subsequent step should generalize a safe structured edit contract.

A corrupted/missing source .blend fails **before invoking Modal**. The caller cannot submit a path to the MCP API, and must own the project. `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET` continue to be read from the claimed job owner's encrypted account; the temporary process receives no other owner's secrets. Failed or uncertain jobs follow the DEV-006/010 fail/recovery state machine, with no automatic rerun of an already-started billable sandbox.

## Verification

CI: Python Modal fake-SDK lifecycle tests prove prior-scene upload, correct headless command, v2-only artifact retrieval and sandbox cleanup. PostgreSQL/TypeScript tests prove verified source selection, v1 immutability, v2 publication, ownership, tamper rejection and unsupported revision refusal. Docker build and Blender smoke regressions continue to run.

External Google/ChatGPT login and personal Modal billing tests from DEV-008/009/010 remain deferred; no billable Modal sandbox was run for DEV-011.
