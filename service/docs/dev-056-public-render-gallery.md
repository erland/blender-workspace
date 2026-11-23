# DEV-056 – Explicit public render gallery for a shared revision

## Behavior

- An existing owner-created share stays bound to one immutable project revision.
- On the owner **Dela revision** page, a gallery selection form lists the
  latest completed, checksum-verified PNG renders belonging to that revision.
  The owner may explicitly publish 0–12 images. Saving selection updates
  the existing share in place **without changing its token**.
- New renders are never published automatically; the list is a whitelist
  snapshot, not a dynamic query for all completed renders.
- The public page displays selected PNG thumbnails and links to full-size PNG.
  Every image request independently verifies the active token, selection,
  owner, project, exact revision, completion status, recorded SHA-256 and bytes.
- Removing an image or revoking the share immediately causes subsequent
  anonymous image requests to return 404. The browser may retain already
  downloaded image bytes.
- The public gallery is entirely read-only: no Modal jobs, uploads, edits,
  access to other revisions or Blender downloads.

## Security and migrations

- Migration `018_public_share_renders.sql` relaxes DEV-055's strict no-renders
  check *only* to allow a bounded, non-empty whitelist when
  `allow_renders=true`. `allow_download=false` remains DB-enforced.
- The repository validates the entire selected list atomically in PostgreSQL
  using an owner-scoped `UPDATE` plus correlated `NOT EXISTS` over each
  completed render job from the same exact revision. Invalid IDs never
  partially publish.
- The owner form requires a signed browser session, same-origin request and
  CSRF token; the service verifies every selected PNG's checksum before
  changing the whitelist. Owner-only private image routes remain unchanged.
- Public HTML and images are served with `Cache-Control: no-store`,
  `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`.
- The token remains stored only as SHA-256 in PostgreSQL and never appears
  in a DB list API. Sharing a link means its holder can view the selected
  images; this does not prevent redistribution or local copies.

## Verification

- PostgreSQL integration tests for same-owner/revision selection, cross-user
  denial, duplicate IDs, whitelisting, empty selection, revocation, and
  BLEND download remaining disabled.
- Web tests for owner form, image filtering, public gallery, CSRF/Origin
  protection, corruption rejection, removal and token revocation.
- Manual iPad/iPhone acceptance: publish a share, select two images, open
  the link in private Safari, open each image, uncheck one and confirm its
  public URL now returns 404. Add a new rendering and confirm it is private
  until explicitly checked.
