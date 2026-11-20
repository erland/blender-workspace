# Portable Blender Workspace project archive — proposed next PR

## Recommendation
Implement export and import together as a separate PR after permanent deletion is verified.
UX: export -> download and verify -> optionally delete -> import as new project.
An archive is not a substitute for an ordinary GLB download because a project
also includes the native Blender files, all revisions and metadata.

## Proposed portable format
Extension: .bwproject.zip (versioned ZIP).
- project.json: schema version, name, description, original project ID and timestamps.
- revisions/00000001/...: per-revision stored manifest with SHA-256 and all immutable
  artifacts (scene.blend, scene.glb, scene.json, and supported auxiliary artifacts).
- history.json: revision notes/timestamps and a sanitized job journal.
  Exclude OAuth and Modal credentials, owner keys, filesystem paths and provider secrets.
  Python source could contain user secrets: offer an explicit choice to include scripts
  or leave them out, and document whether the archive is a full-fidelity snapshot.

## Export
Only signed-in owner may export. Stream files and verify artifact hashes during
export rather than loading everything into RAM. Send a no-store attachment
response with no embedded access token. No Modal execution.

## Import
- Validate the supported version, paths, file counts, per-file and expanded total
  size limits, checksums, compression ratio and JSON schemas before publishing.
- Reject traversal paths, absolute paths, symlinks, duplicate entries, unknown
  entry types, encrypted archives and any checksum mismatch.
- Allocate a NEW project UUID and owner key; remap artifact directory names,
  manifest project IDs and database prefixes while preserving revision numbers,
  names, notes and object identifiers embedded in model artifacts.
- Stage and verify every revision before making the project visible. Roll back
  failed partial imports or quarantine them for retryable cleanup.
- Import cannot run Blender or incur Modal costs; reimporting the same archive
  should produce a separate copy each time.
- Do not copy session tokens, encrypted account records or raw credential data.

## Acceptance scenario
Export Integrationstest 001 (revision 1 cube, revision 2 cube plus cylinder).
Download and retain the archive, import it as a NEW project, and verify both
revisions, geometry, original artifact hashes and viewer behavior. Then, with
user approval, permanently delete the original. The imported version must
remain editable to revision 3 with a valid Blender predecessor.

## Tests
Cross-owner isolation, no credentials, CSRF/origin, archive path traversal,
ZIP bombs, manifest mismatch, interrupted import, repeated import, restored
revisions, storage checksums and no unnecessary Modal jobs.

This document is a design proposal; no export/import endpoints are included
in the permanent-deletion PR.
