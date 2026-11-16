# One-shot Modal job worker (DEV-006)

The worker has Node.js, TypeScript orchestration, Python 3, pinned Modal SDK and the Blender build context. It is **separate** from the public MCP service image.

```sh
docker build -f job-worker/Dockerfile -t blender-workspace-worker:dev006 .
# Supply DATABASE_URL, MODAL_TOKEN_ID, MODAL_TOKEN_SECRET and bind-mount a writable volume.
docker run --rm --env-file ./worker-secrets.env \
  -v /your/persistent/volume:/data/blender-workspace \
  blender-workspace-worker:dev006 create internal-operator "Cube monster"
```

The example uses a local, trusted owner key. Do not commit the env file. In production, derive ownership from server-side authorization rather than permitting arbitrary identity input. The image does not run a persistent service and should not be exposed publicly.

To validate the end-to-end flow, use the manually triggered **DEV-006 Modal live** GitHub Actions workflow after it reaches `main`. It creates an isolated PostgreSQL 16 test database, builds this worker, executes a real Modal job using repository secrets and uploads artifact evidence. This is a billable Modal operation and is not triggered for every PR.
