# Portable Blender Workspace project archive (format v1)

## User flow
1. Sign in on the web portal and open the project.
2. Choose **Exportera projekt (ZIP)**. The browser downloads
   `blender-project.bwproject.zip`; keep this archive outside the service.
3. On **Mina projekt**, choose a .bwproject.zip file and click **Importera**.
   A new project is created with a new UUID and the revision list is restored.
4. Verify each restored revision and GLB in the browser **before deleting**
   the original project. Do not rely on the ZIP alone as a verified backup.

No Blender execution or Modal credentials are necessary for export/import.

## Archive format
The format is a strict ZIP with:
- `project.json`: formatVersion=1, project originalId/name/description/currentRevision,
  and ordered revision metadata (revision, note, createdAt, artifact manifest).
- `revisions/00000001/scene.blend`, `scene.glb`, `scene.json` and other
  stored artifact files for each revision. Exact bytes are preserved.
- Each entry is validated against size and SHA-256 in project.json.
- Reimport is independent: all revision manifest IDs and paths are
  re-created for the newly allocated project.

**Scope note:** The archive contains all model revisions, original Blender
project files, GLB exports, scene JSON and revision notes. It does **not**
contain job execution history, past Python editing scripts, Google identity,
OAuth sessions, Modal tokens, or execution logs. The source scripts could
contain sensitive credentials or user-provided secrets; a future optional
history export needs separate security review. The archive is therefore a
portable **model project backup**, not a full operational audit backup.

## Guardrails
- Import accepts at most **128 MiB** compressed archive input and
  **128 MiB** total uncompressed artifact content, at most **64 MiB per file**,
  at most 99 revisions, at most 12 files per revision, and at most 1,200 files.
- Names must match the fixed revision and artifact-name vocabulary.
- ZIP archive traversal, symlinks, unsupported compression, encrypted files,
  duplicate and unexpected entries, ZIP bombs, invalid metadata and SHA-256
  mismatch cause rejection.
- The Google session and owner identity are checked for each export;
  import also requires same-origin browser POST and per-session CSRF.
- Imported projects are hidden during staging, and become visible only after
  all revisions have been copied and published. Failed imports clean up their
  files and hidden database records.
- The archive is processed by static `archive_tool.py`, not by Blender.

## Limitations
The initial size limit excludes some large Blender scenes. Importing arbitrary
ZIPs from unknown sources is not recommended even with structural validation;
imported Blender files should be treated as untrusted when subsequently opened
or executed. Import does not execute Python, Blender scripts, modifiers or
drivers.

## Tests
Round-trip export and import of two saved revisions; SHA-256 equivalence of
artifacts, notes and version numbers; ability to add a third revision to the
import; owner isolation, unauthenticated export rejection, CSRF/origin
validation, truncated/malformed archive rejection, rollback of failed imports.

No Modal jobs are started by these tests.
