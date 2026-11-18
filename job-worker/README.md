# Blender Workspace job worker

Build a separate Docker image using `job-worker/Dockerfile`, context repository root.

## DEV-010 – automatic dispatcher

Run with command `dispatch` as a **dedicated continuously running Coolify service**, with access to PostgreSQL and the persistent project artifact volume. It polls for pending jobs and atomically claims them across worker replicas using PostgreSQL row locks. Each job runs with its verified owner's encrypted Modal credentials (DEV-009), not a shared Modal account.

Full environment/deployment/recovery steps: [DEV-010 dispatcher](../service/docs/dev-010-dispatcher.md).

## Trusted operator commands (not user-accessible)

`run OWNER JOB_ID`, `recover OWNER JOB_ID`, `modal-status OWNER`, `modal-test OWNER`, `modal-disconnect OWNER`, and `modal-connect OWNER` (JSON credentials via protected stdin) remain available for protected administrative use only.

Never expose the CLI on a public HTTP endpoint. Do not set `MODAL_EXECUTION_MODE=legacy` in the dispatcher service. A manual, explicitly isolated DEV-006 Modal live test still uses legacy mode to preserve its original regression fixture.

Google-authenticated browser settings for Modal account provisioning are served by the MCP application at `/settings/login`; never send Modal tokens as MCP tool arguments.
