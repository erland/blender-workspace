# DEV-009 – Personal Modal accounts (core)

This implements the account/worker boundary using the same architectural principles as Agent Workspace. One verified Blender Workspace owner has **one independent Modal token**, encrypted using AES-256-GCM, with an owner-bound AAD. The Python worker receives only the claimed job owner's token via child-process environment; global workspace Modal tokens are stripped to prevent accidental cross-account billing.

## Included

- PostgreSQL migration `004_modal_accounts.sql` for ciphertext, IV, auth tag, status and owner
- `ModalAccountManager`: verified save/replace, status, re-test, delete, owner-isolated retrieval
- `ModalCliTokenVerifier`: executes `modal token info` with candidate credentials; output and secrets never logged
- New MCP tools when store configured: `workspace_modal_status`, `workspace_modal_test`, `workspace_modal_disconnect` (separately authorized read/write)
- New worker commands: `modal-connect OWNER`, `modal-status OWNER`, `modal-test OWNER`, `modal-disconnect OWNER`, and `run OWNER JOB_ID`. `modal-connect` receives JSON `{"tokenId":"...","tokenSecret":"..."}` from **stdin**, never command arguments.
- Existing `run` uses the owner from the **claimed database job**, not an arbitrary supplied output folder or credential identity.
- `MODAL_CREDENTIAL_ENCRYPTION_KEY`: mandatory for personal-account storage; use `openssl rand -base64 32` and store in Coolify secrets, backed up safely.

## Explicit limitations and security

**Do not treat the internal CLI as an end-user settings page.** This step provides the secure server-side account core and operator provisioning. A Google-authenticated, CSRF-protected browser settings page analogous to Agent Workspace remains to be implemented and verified. No Modal token is accepted in a ChatGPT/MCP tool argument. A user cannot presently self-onboard without a trusted operator, and no public production readiness is claimed.

Do not accept arbitrary `OWNER` values from HTTP users when invoking the operator CLI: the account must be associated with the authenticated owner key. Existing OAuth owner keys are derived from issuer and Google subject. CLI is strictly for trusted operators in a protected environment, with a trusted source for the owner identity.

The CLI environment is fail-closed by default: without `MODAL_CREDENTIAL_ENCRYPTION_KEY`, normal jobs cannot use shared tokens. The temporary DEV-006 live regression workflow sets `MODAL_EXECUTION_MODE=legacy` **explicitly** for its internal, billable sandbox test. Never enable legacy mode in a public multi-user deployment.

When the credential store is configured, queuing a job requires an existing connected Modal account; if disconnected, queued jobs are rejected. A worker refuses to execute without a connected account. Costs are thus associated with the selected Modal token, not the ChatGPT or Blender Workspace service account. Actual billing and per-user Modal isolation are not yet externally verified.

No Google account connection, real Modal API credential, storage key or user password is needed for the automated tests. GitHub Actions validates encryption, tamper detection, owner isolation, credential replacement, disconnect, safe worker environment and simulated job owner routing. The real Modal credential test/worker execution still requires a later integration gate.

The current verifier deliberately does not return raw provider failure information to MCP clients. A verifier failure is currently classified as a general test failure; distinguishing revoked credentials from transient networking errors needs more diagnostics before auto-marking a connection revoked.
