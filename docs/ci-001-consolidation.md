# CI-001 Consolidated GitHub Actions

The 25 DEV-specific workflow files have been replaced by five responsibility-based workflows. This is a *workflow* consolidation, not deletion of application tests.

| Workflow | Trigger | Verification |
| --- | --- | --- |
| CI - Service | PR, main push, manual | Full `npm run check` with PostgreSQL, migration idempotence, Python-only MCP boundary |
| CI - Blender | PR, main push, manual | Python suite, Blender create/edit/revision/animation, real geometry, PBR material reuse |
| CI - Deployment | PR, main push, manual | Three production Docker builds, service preflight, worker pinning, Coolify Compose validation |
| Release - GHCR | Published release, manual verification | Full release gate, images only published for stable releases |
| Live - Modal tests | Manual only | Explicitly selected Modal Sandbox or benchmark; both may incur costs |

## Guarantees
- No paid Modal jobs are launched from PR or main CI.
- Release publication requires a published non-prerelease GitHub Release, a stable version and a commit from main.
- The normal test jobs are deliberately not path-filtered: stable status checks are suitable for branch protection.
- PR superseded runs can be cancelled; published releases and paid/manual jobs cannot.
- One service test run, one Blender image build and one deployment image set replace repeated builds.
- Geometry/material/animation checks remain part of the Blender workflow.
- Keep test cases in their ordinary test suites; do not add a new workflow per DEV step.

## Manual action before merge
GitHub's connected app could query repository rulesets (none returned), but could not read branch protection (HTTP 403). An administrator must verify any required status checks reference the new job names and remove requirements for retired checks **before merging**. Record that check as externally pending, not PASS.

## Acceptance
GitHub Actions must pass all three CI workflows for the PR head SHA. Validate a future GitHub Release separately (publication is intentionally not exercised by PR CI). Live personal Modal and browser/iPad verification remain outside non-billable CI.
