# DEV-057 – Opt-in public native BLEND download

## Intended behavior

A project's owner may explicitly enable or disable download of the **exact immutable
revision** on an already active public share. Disabled is the default, including on
new and republished shares. The token remains unchanged when this setting changes;
republishing always rotates the token and resets permission to off.

The public viewer shows the download link only when the owner enabled it. The URL
`GET /share/{token}/scene.blend` is completely read-only, without Google authentication,
and checks the token and permission again on **every request**. It streams only the
SHA-256-verified stored native `scene.blend` of that revision; it never runs
Blender, Modal, conversions or an on-demand ZIP build.

### Bundled resources and limits

DEV-052 packs supported external resources into the BLEND during the original
modeling save (`bpy.ops.file.pack_all()`). Consequently the *existing* native file
already contains packable image textures; a separate ZIP of the same textures would
be redundant. Native Blender's un-packable external resources (e.g. some caches,
linked library files, video sequences) **are not guaranteed to be included**.
This implementation must not promise all dependencies are portable. The original
owner history exposes any recorded external-dependency warning. Future dedicated
complete-package support would require a verified inventory, copies and safe
archive creation; it is deliberately not inferred from the absence of a warning.

### Security

- Owner changes use signed Google session, same-origin POST and CSRF; only an
  owned, existing and active share row can change.
- Enabling requires SHA-256 verification of the exact committed `scene.blend`
  before updating the database. File corruption discovered later returns 404.
- The public route returns 404 for disabled, expired, revoked, rotated or malformed
  links and missing/corrupt BLEND files, without leaking ownership.
- Public responses are `no-store`, `noindex`, `nosniff`, `no-referrer`,
  `Content-Security-Policy: default-src 'none'` and use a sanitized, fixed-
  extension download filename.
- The owner cannot prevent an already downloaded copy from being redistributed.
  Turning off permission prevents only **new** fetches.

### Verification

PostgreSQL tests: owner/other owner, wrong revision, enable/disable, token
resolution, revocation. HTTP tests: default-off, correct owner and CSRF/Origin,
explicit toggle, public file bytes and headers, checksum failure, disable,
revocation, malformed token.

Run the service Node tests and PostgreSQL integration tests on the PR. For live
acceptance, use a share in a private Safari session, download and reopen the
BLEND in desktop Blender, disable permission, confirm a *new* fetch returns 404,
then revoke and confirm all public routes return 404. This must not trigger
billable Modal operations.
