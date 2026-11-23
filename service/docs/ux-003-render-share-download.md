# UX-003 – Rendering, download and sharing

## Implemented

- The latest-model overview has a direct **Rendera bild** action that
  opens the Images view with the existing render form expanded.
- Rendering choices explicitly distinguish a faster Eevee preview from a
  more realistic Cycles image. Quality controls remain unchanged, with
  a plain-language explanation that image size, sample count and engine
  influence execution time and cost. No fixed price is invented.
- Starting a billed Modal render now requires **explicit consent** through
  a required checkbox. The POST route independently enforces
  `confirm=yes`, before reserving a job. Existing CSRF, Origin,
  owner identity and configured Modal checks are retained.
- The share administration view shows an upfront active/revoked/not-yet-
  published state, a summary of the recipient's rights, and two clear
  settings: allow download and select publicly visible finished images.
- Download language correctly distinguishes plain BLEND from portable
  BLEND + texture ZIP. Existing permissions and verified native/ZIP
  packaging logic are untouched.

## Not in scope

The 3D-viewer 'render current view' action uses its own client workflow,
including options and explicit submission. It remains unchanged; this PR
focuses on project-level render initiation, download clarity and public
sharing administration. It does not add any paid Modal jobs to CI.

## Verification

New web regression tests cover the project render path, default latest
revision, cost confirmation and active/revoked download rights.
The older render permission tests also enforce consent.
Visual acceptability on iPhone/iPad is not proven by CI and needs an
actual browser inspection after deployment.
