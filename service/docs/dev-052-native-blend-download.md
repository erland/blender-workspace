# DEV-052 – Download a native BLEND revision for local Cycles rendering

## User workflow

Open a project, choose **Historik**, then use **Ladda ned BLEND**
beside any saved revision. The actual immutable `scene.blend` is streamed
without another Blender/Modal job. The download filename includes a sanitized
project name and revision, e.g. `R2D2-robot-rev-15.blend`.

The browser endpoint `GET /projects/:projectId/revisions/:revision/download`
uses the existing HttpOnly, signed Google session. It checks ownership and
revision state, then verifies the artifact manifest and SHA-256 before
streaming bytes. Invalid, foreign, missing or corrupt revisions all return
404. No credentials appear in the URL.

## Portable resources in new revisions

During the **existing modeling Sandbox**, after user Python completes but
**before** saving the native BLEND, `bpy.ops.file.pack_all()` embeds packable
textures, sounds and fonts. The native BLEND remains uncompressed so the
existing artifact pipeline can verify its header without running Blender.
The immutable `scene.json` includes a bounded `portableResources` summary:

- `complete`: pack operation succeeded and no supported external-resource
  categories remain unresolved
- `external`: one or more known external file dependencies remain; local
  Blender may require those files
- `unknown`: pack operation or auditing could not be completed

The summary stores **only counts and fixed categories**, never user file paths
or private names. It is validated by the trusted artifact validator and
rechecked before being shown on a history page.

Old revision artifacts are **never rewritten**; they do not automatically
gain resource status. Older reports and invalid metadata appear as
**Externa resurser ej verifierade**.

The current artifact store has no independently preserved external texture
assets, so a ZIP cannot safely or truthfully claim to contain missing
resources. Instead we download the self-contained BLEND when packing works
and explicitly warn when external references remain. The existing
`Exportera projekt (ZIP)` option is intended for project backup/restore,
**not** as proof that all external dependencies are included.

## Limitations

Blender's Pack Resources is not a universal dependency packager. Movie and
image sequences, cache files, volume references, external linked libraries
and third-party add-on data can still require additional files. A `complete`
summary means **no known un-packed references in the categories audited**,
not a guarantee that every Blender add-on or machine-specific resource is
portable.

## Tests

- Headless Blender CI creates an externally textured cube, calls packing,
  saves the BLEND, deletes the texture source, reopens and verifies the
  embedded image still exists and is assigned.
- Service tests check signed-owner isolation, invalid/missing revisions,
  integrity verification, safe project-name filenames and history badges.
- Downloading never starts a paid Modal job.

After deployment, download a recent native scene and open it on the Mac in
local Blender. Run a short Cycles preview before a long animation.
