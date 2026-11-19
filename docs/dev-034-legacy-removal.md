# DEV-034: Python-first consolidation — dependency inventory

## Baseline

DEV-033 (PR #40) removed the legacy typed and demo MCP write **tools**. The only
MCP authoring tool is `workspace_queue_python_script`. The earlier implementation
and corresponding historical CI suites still remain in the repository. This is
not a backward compatibility commitment: no end user has adopted the retired API.

## Remaining internal dependencies

| Area | Legacy code still present | Removal condition |
|---|---|---|
| `service/src/jobs/job-repository.ts` | `edit_spec`, typed `operation_spec`, permissive `reserve` | Retain DB columns for reading historical rows if necessary; reject new non-Python jobs; preserve optimistic revision lock and job recovery |
| `service/src/jobs/orchestrator.ts` | `createDemo`, `reviseDemo`, structured edit/operation branches, monster file names | Replace with Python-only execution and verified `scene.blend` predecessors, retain atomic artifacts and recovery |
| `service/src/jobs/modal-executor.ts` | Demo/structured operations and CLI flags | Python-only invocation, keep isolated credentials and timeout/cleanup |
| `modal_provider/runner.py` | Smoke/demo, structured edit/operation branches | Python-only Sandbox path with mandatory success marker, output verification and network blocking |
| `blender_workspace_poc/` | Demo and structured operation scripts | Preserve `apply_python.py` and its imported dependencies; delete retired workers only after confirming import closure |
| `service/__tests__`, `tests/`, `.github/workflows/` | Historical demo/structured regression suites | Replace essential owner, revision, failed publish, recovery, sandbox cleanup and GLB integrity coverage with Python-first cases before retiring old tests/workflows |

## Guardrail in this change

`python3 scripts/check_python_first_boundary.py` validates the **production MCP
registration** and key Python authoring validation hooks. The CI workflow runs
this independently of obsolete demo tests. This does **not** certify Python
Sandbox isolation or finish removal of the internal legacy branches.

## Planned implementation sequence

1. Migrate persistence/orchestration tests to Python-first revisions and artifact recovery.
2. Remove obsolete TS command schemas and legacy dispatch/executor branches.
3. Remove obsolete Modal runner branches, demo workers, and superseded CI suites.
4. Run full surviving CI including real headless Blender and repeat the contract check.

Live Google/ChatGPT OAuth, personal Modal billing and browser/iPad acceptance remain deferred.

## DEV-034C migration

The legacy `jobs.test.mjs` and `dispatcher.test.mjs` suites were converted to
Python-only queue jobs with `scene.blend` / `scene.glb` / `scene.json` artifacts.
They retain owner authorization, atomic job claiming, stale revision rejection,
worker failure, tampered-artifact rejection, retry and recovery checks.
The separate DEV-034B PostgreSQL recovery tests provide additional immutable
revision coverage. Older typed operation schema tests are intentionally retired
from these suites: these operations are no longer an MCP product contract.
Remaining internal implementation and Python legacy runner tests are to be
removed after CI acceptance of this test migration.

## DEV-034D: production TypeScript execution consolidation

- Removed retired demo, fixed blue recolor, structured edit and typed scene
  operation **execution branches** from `JobOrchestrator`.
- Removed the corresponding subprocess invocation methods and legacy
  credential fallback from `ModalPythonExecutor`; it now always requires
  connected owner-scoped Modal credentials.
- Existing Python scripts alone write `scene.blend`, `scene.glb`, `scene.json`.
  Non-Python historical queued work fails closed before a Blender worker
  starts. Database columns and prior immutable artifacts have not been
  deleted.
- Preserved checksum-verified predecessor loading, immutable publishing,
  recovery without re-execution and job state transitions.
- Updated Modal account tests and added an explicit fail-closed regression.

**Still outstanding:** remove accepting legacy forms from the repository
write API, retire old CLI branches in `modal_provider/runner.py`, remove
unused Blender scripts/TypeScript schemas and replace historical CI.
