# DEV-002 – Modal Sandbox proof of concept

## Purpose

Reuse DEV-001's Blender image and smoke script in a short-lived Modal Sandbox. The script creates a rigged animated monster, reopens and recolors its Blender project, and exports both GLB revisions. After execution, six files are copied back and validated. The Sandbox is terminated in a finally block.

## Commands

PR checks run Python provider tests without Modal credentials or billable resources.

For a genuine integration test, configure GitHub Actions repository secrets `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`. Then run the **Modal DEV-002** workflow manually on the feature branch using `workflow_dispatch`. The live job uses pinned `modal==1.4.1`, 2 physical CPU cores, 8 GiB, a 900-second sandbox timeout and no GPU.

Local equivalent:

```bash
python -m pip install 'modal==1.4.1'
python -m modal_provider.runner --out out-modal
python tests/verify_manifest.py out-modal
python tests/verify_glb.py out-modal/monster_v1.glb out-modal/monster_v2.glb
```

Modal credentials must be provided through environment variables or Modal auth; never commit them.

## Security and cost

No user-supplied executable script is accepted in this PoC. Sandbox networking is disabled, runtime bounded, and termination is attempted after both success and failure. The output report has artifact hashes, runtime stages, terminal status and an approximate USD compute cost based on current Sandbox reservation rates. It is **not a measured invoice**; image-build, storage and transfer charges are excluded. Review actual costs in the Modal dashboard.

## Acceptance

- Real Modal Sandbox starts and runs the original headless Blender smoke with `BW_SMOKE PASS`.
- Two Blender revisions, two animated GLBs and two manifests are downloaded and verified.
- The Sandbox is confirmed terminated, with timeout/failure cleanup tested.
- Durations and estimated cost are recorded.
- Reproducible live GitHub Actions evidence is retained.

**Current status: verification_pending** until an authenticated Modal run has passed. Unit tests alone do not complete DEV-002. Subsequent Coolify, MCP and PostgreSQL integration is out of scope.
