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

## DEV-034E1: reservation safety boundary

`JobRepository.reserve` no longer imports or parses the retired structured
edit / scene-operation command schemas. New reservations **must** include a
`python_script` specification, validated before a PostgreSQL connection is
opened. Legacy edit payloads, absent operations and arbitrary operation kinds
are rejected instead of persisted. The existing `edit_spec` database column
remains present (new values are always null); old rows continue to fail closed
in `JobOrchestrator`, which never invokes the retired Blender workers.

The six-argument internal repository signature temporarily retains an
always-undefined legacy edit slot to avoid an unrelated call-site migration in
this bounded step. It is **not** a supported compatibility interface and should
be removed with the final repository/API cleanup.

This step does not delete the legacy Python Modal-controller branches or
Blender demonstration scripts. Those require test/CI migration and are the
next cleanup step. No claim of live user-billed Modal or OAuth verification.

## DEV-034E2: Python-only Modal controller

The trusted Modal controller now requires `--python-file` and accepts no
`--operation-file`, `--edit-file`, demo or fixed recolor execution mode.
Every job runs the fixed `apply_python.py` entrypoint in a network-blocked
Sandbox, optionally uploading the prior verified BLEND for revision >= 2.
The controller requires the `BW_SANDBOX_PYTHON PASS` marker and validates the
BLEND/GLB/JSON artifact structure before returning success. It always attempts
to terminate the Sandbox and records transfer/compute estimates, not actual bills.

`tests/test_modal_provider.py` was replaced with Python-only lifecycle tests,
including missing source, UTF-8/size validation, marker spoofing, invalid
artifacts, cost estimation, failure and cleanup.

The old Blender demo/typed scripts and historical tests/CI have **not** yet
been deleted. Removal follows after this combined branch passes CI.

## DEV-034E3A: remove legacy execution from baseline CI

The always-on `.github/workflows/blender-headless.yml` no longer creates
or recolors the demo monster. It builds Blender, executes `apply_python.py`
for a new model and a subsequent saved revision, validates both BLEND/GLB/JSON
artifact sets, and checks object identity stability across revisions.
The opt-in Modal DEV-002 smoke now supplies `--python-file` and validates
Python-only artifacts; live execution remains optional and billable.

The old demo scripts and their dedicated historical workflows are still
present. Removing those files without migrating remaining CI dependencies
would break checks, so their deletion is a separate E3B step.

## DEV-034E3B: retired typed Blender workers

Removed the obsolete Python Blender `apply_operation.py`, `edit_scene.py`,
`scene_operation_validation.py`, `scene_edit_validation.py` and
`glb_import_validation.py`, their typed operation unit tests and four
legacy Blender verifiers. Also retired dedicated CI for DEV-012 structured
edits, DEV-014 generic operations and DEV-015 batched operations. These
workflows existed exclusively to run now-unsupported typed authoring paths.

The Python-first worker `apply_python.py`, shared scene/geometry/material
helpers, owner authorization, immutable revisions, the baseline Blender
Python-first smoke, and isolated Python Sandbox CI are retained. Generic
job/revision and Modal tests remain. The old monster demo and retired
TypeScript schemas are deliberately **not** removed in this change; they
will be handled in a separately verified step. Verification of this PR is
pending.

## DEV-034E3B CI repair and verification

The remaining DEV-032 material-library workflow still depended on the removed
`apply_operation.py` and typed material validation. It now executes Blender
`apply_python.py` for both creation and revision, creates and reuses one named
PBR material, and checks exported GLB materials, saved library metadata,
three model objects, and stable object IDs. The retired typed-only material
validation test was also deleted. All four triggered PR workflows passed
on implementation SHA `405b755c311f38d242ceb8df3a3a97ea29bc03d4`.

The remaining monster demo/legacy TypeScript schemas are deferred to E3C.
