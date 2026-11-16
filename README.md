# Blender Workspace

A headless Blender proof of concept for Blender Workspace. The planned service will expose a remote MCP endpoint from Coolify, persist project metadata in PostgreSQL, and run short-lived Blender jobs on Modal. **None of those integrations is implemented by DEV-001.**

## DEV-001

The Python scripts create a cube-bodied, two-legged monster with rigging and a looping walk animation, export `.blend` and animated `.glb`, reopen the saved Blender file in a separate process, recolor the monster, and export revision two.

Run with Docker:

```bash
./scripts/run_docker.sh
```

The generated files are in `out/`:
`monster_v1.blend`, `monster_v1.glb`, `monster_v1.json` and the corresponding v2 files.

## GitHub Actions

The **Blender headless DEV-001** workflow builds Blender in Docker, executes the actual Blender scripts, checks project reopening and animation export, and publishes generated files as an Actions artifact. The run must pass before DEV-001 may be marked complete. Python unit tests alone are not sufficient.

## Current status

DEV-001 is **verification_pending** pending a genuine GitHub Actions runtime PASS. No Modal, Coolify, PostgreSQL or MCP functionality exists yet.
