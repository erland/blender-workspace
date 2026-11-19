# GHCR image publishing from GitHub Releases

The workflow `.github/workflows/ghcr-dev036.yml` continues to **verify**
code on pull requests and pushes to main, but **does not publish images**
on these events. Publication occurs only on the `release: published`
event for a **stable** GitHub Release with a tag exactly matching
`vMAJOR.MINOR.PATCH` (for example `v1.2.3`). The release commit must
be an ancestor of `main`; prereleases and other tags cannot publish.

The release workflow verifies Node/MCP/PostgreSQL tests, Python/Modal
controller tests and real local Blender Docker execution before any
GHCR push. There is **no billable Modal execution**.

For a release `v1.2.3`, three packages are published with **both**
`v1.2.3` and `latest` tags:

- `ghcr.io/erland/blender-workspace-mcp:v1.2.3`
- `ghcr.io/erland/blender-workspace-job-worker:v1.2.3`
- `ghcr.io/erland/blender-workspace-blender:v1.2.3`

The same packages also receive `:latest`. `latest` moves on each new
stable release and is convenient for simple redeployment, but does not
automatically update containers already running in Coolify. Choose a
fixed `v1.2.3` tag if you need a reproducible deployment or rollback.
Only create a new release version from a verified main commit. Do not
reassign existing release tags; GHCR version tags are technically mutable.

The Job Worker image embeds **the matching fixed Blender version**:
`MODAL_BLENDER_IMAGE=ghcr.io/erland/blender-workspace-blender:v1.2.3`.
Even when Coolify uses `latest`, that worker continues to request the
Blender image belonging to its own release; it does not use the mutable
Blender `latest` tag. The Modal runner also accepts legacy sha-commit
tags and pinned `@sha256` digests, but rejects `latest` as a direct
Modal image reference.

## First release

1. Merge the change to `main` and wait for normal PR/main checks.
2. In GitHub, open **Releases → Draft a new release**.
3. Create a new tag, e.g. `v1.2.3`, **targeting main**, and publish a
   regular (non-prerelease) release.
4. Open the `Verify and publish release GHCR images` workflow run.
   Confirm that verify and publish both passed and that all three
   packages have both version and `latest` tags.
5. Set the Blender GHCR package to **public** in GitHub Packages so
   individual users' Modal accounts can pull it. MCP/worker packages
   may remain private if Coolify has registry pull credentials.
6. Configure Coolify `BW_IMAGE_TAG=v1.2.3` or `BW_IMAGE_TAG=latest`
   using [the Compose guide](dev-037-coolify-compose.md).

Publishing requires `GITHUB_TOKEN` with scoped `packages:write`
in the publish job; some repositories must also grant Actions access
to existing GHCR packages. No personal GHCR/Modal token is needed for CI.

## Deployment

The [Coolify Compose file](../deploy/coolify.compose.yaml) runs
`migrate`, `mcp` and `job-worker`, and connects to an **external**
PostgreSQL database using separate environment values
`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE`.
The migration must succeed before the two long-running services start.
Only MCP needs the external HTTPS domain.

For upgrades change `BW_IMAGE_TAG` to the next published version.
For `latest` redeploy with an actual image pull and check the new
container image digests; an already running container does not update
itself. Avoid redeploying the worker during an in-flight paid job.
Take database/artifact backups, retain signing/encryption keys and
verify migrations as described in the Compose guide.

## Boundaries of verification

PR checks can prove image builds, Python tests, headless Blender
execution and worker image selection. They **cannot** prove GHCR push
or registry visibility until a real release is published. Coolify
deployment, live Google OAuth and owner-funded Modal acceptance must
be verified separately. Neither `latest` nor a release tag is an
image-content digest; use an explicit digest when stronger artifact
pinning is required.
