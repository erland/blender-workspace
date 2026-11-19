# DEV-036 — GHCR image distribution

## Deployment contract

GitHub Actions builds and verifies three Linux/amd64 images. On a `main`
push (or manual dispatch **on main**), the
`.github/workflows/ghcr-dev036.yml` publish job runs only after its
own offline unit, PostgreSQL, container build and real headless Blender
smoke gate succeeds. Pull-request runs never publish packages and never
allocate a Modal Sandbox.

For verified commit `<40-hex-sha>`, deploy **the same** SHA tag for all
three images:

- `ghcr.io/erland/blender-workspace-mcp:sha-<sha>`
- `ghcr.io/erland/blender-workspace-job-worker:sha-<sha>`
- `ghcr.io/erland/blender-workspace-blender:sha-<sha>`

Do not use `latest`: changing tags undermine reproducibility. GHCR
`sha-<sha>` tags are *intended* as immutable release references, but
GHCR tags are technically mutable; a pinned `@sha256:` digest is
stronger. The controller accepts either a full commit tag or a digest.

## GHCR setup

Actions uses the repository-scoped `GITHUB_TOKEN` with `packages: write`
only in the publish job. No personal registry token or Modal credentials
are required to publish. The repository/package owner may need to enable
the package's Actions access depending on existing GHCR ownership.

**Important manual action:** GHCR packages may default to **private**.
Make the **Blender image package public** in GitHub Packages settings
before real owner-billed Modal execution. Modal users have their *own*
Modal credentials, not shared GHCR access. The code deliberately does
not forward GHCR or controller secrets to user Sandboxes. If the image
is private, pulling fails; do not work around it by passing private
registry credentials into the user-supplied Python program.

MCP and Job Worker images may remain private if Coolify is configured
with authorized pull access. No registry credentials should be added to
their image contents.

## Coolify

**Recommended**: use the checked-in
[`deploy/coolify.compose.yaml`](../deploy/coolify.compose.yaml) and
[`docs/dev-037-coolify-compose.md`](dev-037-coolify-compose.md). They
connect to an externally managed PostgreSQL instance with separate
`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` entries in
Coolify. PostgreSQL is **not** a Compose service. A one-shot migration
gate initializes application tables before MCP/worker startup.


Create two container-based services, not three:

1. **MCP service**: image `ghcr.io/erland/blender-workspace-mcp:sha-<sha>`.
   Expose only its HTTP port (3000) through HTTPS and use existing OAuth,
   PostgreSQL, artifact store and credential-encryption settings. Python
   syntax preflight happens here, without running Blender.
2. **Job Worker**: image `ghcr.io/erland/blender-workspace-job-worker:sha-<sha>`,
   command/argument `dispatch` (the image already has the Node
   entrypoint). **Do not expose a public port.** Set `DATABASE_URL`,
   `ARTIFACT_ROOT`, `MODAL_WORKER_ROOT=/app` and
   `MODAL_CREDENTIAL_ENCRYPTION_KEY`, with the exact same persistent
   artifact volume and private database as the MCP service.
   One worker replica is sufficient initially.

The published Job Worker image bakes in
`MODAL_BLENDER_IMAGE=ghcr.io/erland/blender-workspace-blender:sha-<sha>`.
Do not override that setting unless deliberately deploying a reviewed,
equivalent pinned digest or tag. Confirm the actual image reference from
the GHCR workflow summary and package availability before starting
worker jobs. The worker itself contains the Modal SDK but **not Blender**.

On upgrades, use a compatible image set from the **same verified commit**,
restart/update both Coolify services together, and do not restart a worker
during an in-flight Sandbox job unless recovery/billing has been reconciled.
The dispatcher's existing fail-safe recovery semantics remain unchanged.

## Modal

The trusted controller now calls:

```python
image = modal.Image.from_registry(
    os.environ["MODAL_BLENDER_IMAGE"], add_python="3.11"
)
```

instead of `Image.from_dockerfile`. This avoids uploading the
Dockerfile/build context to rebuild Blender for each owner or worker
execution. Modal may still incur image-pull/initialization/cache costs;
a registry image does **not** guarantee zero image preparation or
zero cold-start delay. Blender runs only in an isolated, network-blocked
short-lived Sandbox after owner authorization. A missing, unpinned or
non-GHCR image reference fails before any Sandbox allocation.

Real Modal integration is **opt-in**, requires individual Modal tokens
and a publicly readable GHCR Blender package. The DEV-002 manual
GitHub workflow uses the commit-specific reference; execute it only from
a published main revision and only after explicitly deciding to incur
billing.

## Acceptance and verification

CI proves local image builds, unit contracts, simulated Modal SDK image
selection, PostgreSQL jobs, and real *local* Blender creation/revision.
It does not prove that GHCR packages have been pushed until an actual
`main` publish run succeeds, that GHCR visibility is public, that Coolify
can pull and start the images, or that a user-funded Modal Sandbox
successfully uses the published image. Track these as separate
deployment/live acceptance checks, not as completed PR CI.
