# DEV-009 – Personal Modal accounts (core)

This implements the account/worker boundary using the same architectural principles as Agent Workspace. One verified Blender Workspace owner has **one independent Modal token**, encrypted using AES-256-GCM, with an owner-bound AAD. The Python worker receives only the claimed job owner's token via child-process environment; global workspace Modal tokens are stripped to prevent accidental cross-account billing.

## Included

- PostgreSQL migration `004_modal_accounts.sql` for ciphertext, IV, auth tag, status and owner
- `ModalAccountManager`: verified save/replace, status, re-test, delete, owner-isolated retrieval
- `ModalCliTokenVerifier`: uses the official Modal JavaScript SDK with a read-only authenticated request; no Python CLI required in the MCP container
- New MCP tools when store configured: `workspace_modal_status`, `workspace_modal_test`, `workspace_modal_disconnect` (separately authorized read/write)
- New worker commands: `modal-connect OWNER`, `modal-status OWNER`, `modal-test OWNER`, `modal-disconnect OWNER`, and `run OWNER JOB_ID`. `modal-connect` receives JSON `{"tokenId":"...","tokenSecret":"..."}` from **stdin**, never command arguments.
- Existing `run` uses the owner from the **claimed database job**, not an arbitrary supplied output folder or credential identity.
- `MODAL_CREDENTIAL_ENCRYPTION_KEY`: mandatory for personal-account storage; use `openssl rand -base64 32` and store in Coolify secrets, backed up safely.

## Explicit limitations and security

**Google-authenticated self-service settings** are available at `/settings/login` and `/settings`. The browser login generates a short-lived signed HttpOnly cookie and CSRF secret; all account mutations require a same-origin POST and a valid CSRF token. Users can connect, replace, re-test, and disconnect their own credentials. The Modal secret is never passed through a ChatGPT/MCP tool argument or rendered back into HTML. Internal CLI provisioning remains an operator-only fallback. No public production readiness is claimed until DEV-008 and DEV-009 external acceptance is complete.

Do not accept arbitrary `OWNER` values from HTTP users when invoking the operator CLI: the account must be associated with the authenticated owner key. Existing OAuth owner keys are derived from issuer and Google subject. CLI is strictly for trusted operators in a protected environment, with a trusted source for the owner identity.

The CLI environment is fail-closed by default: without `MODAL_CREDENTIAL_ENCRYPTION_KEY`, normal jobs cannot use shared tokens. The temporary DEV-006 live regression workflow sets `MODAL_EXECUTION_MODE=legacy` **explicitly** for its internal, billable sandbox test. Never enable legacy mode in a public multi-user deployment.

When the credential store is configured, queuing a job requires an existing connected Modal account; if disconnected, queued jobs are rejected. A worker refuses to execute without a connected account. Costs are thus associated with the selected Modal token, not the ChatGPT or Blender Workspace service account. Actual billing and per-user Modal isolation are not yet externally verified.

No Google account connection, real Modal API credential, storage key or user password is needed for the automated tests. GitHub Actions validates encryption, tamper detection, owner isolation, credential replacement, disconnect, safe worker environment and simulated job owner routing. The real Modal credential test/worker execution still requires a later integration gate.

The current verifier deliberately does not return raw provider failure information to MCP clients. Differentiate credential revocation from transient networking errors in production monitoring; temporary Modal availability failures should not permanently revoke user credentials.
