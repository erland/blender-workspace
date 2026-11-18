# One-shot Blender Modal worker

The worker executes short-lived sandbox jobs with isolated artifacts. DEV-009 adds per-user Modal credentials.

Set `DATABASE_URL`, `ARTIFACT_ROOT`, `MODAL_WORKER_ROOT` and `MODAL_CREDENTIAL_ENCRYPTION_KEY` (same encryption key securely provided to service and worker).

Use a trusted operator to associate an account with the authenticated owner key. Pass credentials over protected stdin, not command-line parameters:

```sh
# The stdin payload is a JSON object with tokenId and tokenSecret.
# Do not save tokens in shell history or log files.
cat /secure/credentials.json | docker run -i --rm --network trusted \
  --env-file /secure/worker.env \
  -v /persistent/artifacts:/data/blender-workspace \
  blender-workspace-worker:dev009 modal-connect 'oauth:authenticated-owner-hash'
```

`modal-status OWNER`, `modal-test OWNER`, `modal-disconnect OWNER` and `run OWNER JOB_ID` are supported; only trusted operators should invoke them. A connected Modal account is required before running a job. A Google-authenticated self-service settings page is available at `/settings/login` when the MCP service has the encryption key and Google mode configured. Real Google and Modal verification remain deferred. The `MODAL_EXECUTION_MODE=legacy` option is strictly for the existing single-owner DEV-006 integration test; never use it in public deployments.
