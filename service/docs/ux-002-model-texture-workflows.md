# UX-002 – Task-based imports and scene-backed texture targeting

The asset upload page has two task tabs: **Importera 3D-modell** and
**Applicera textur**. Only the workflow relevant to the selected task is
shown; uploads remain private and free, while composition/texture application
requires the existing explicit paid Modal confirmation.

The texture form no longer expects users to type a precise Blender mesh name.
A small same-origin script fetches a bounded list of actual MESH objects from
the most recent committed revision, using the owner's session. The source
is the immutable, checksum-verified `scene.json`; no paid Modal invocation
or arbitrary Blender Python inspection occurs. The initial UI is disabled
until that lookup succeeds. Pending requests cannot overwrite the selected
project's newer responses. Object names are inserted through DOM Option
creation rather than HTML interpolation, protecting arbitrary scene labels.

The texture form includes the selected source revision. The server independently
checks ownership, saved revision, real object existence and the revision
number before queuing a chargeable job. The existing CSRF, origin and Modal
confirmation checks are unchanged. If another revision has been created,
the user gets a conflict and must refresh their selection.

A file upload returns to the matching model/texture task. No resource storage,
Blender material code or public share routes are changed in this step.

## Limitations

- Object picker is supported for verified scene reports and has a maximum
  native mesh name length of 200 matching the model-job contract. A corrupt,
  missing or unsupported report blocks the workflow rather than asking
  the user to guess a mesh name.
- The first iteration uses a dropdown rather than touch selection in WebGL.
  In-view object selection could be added later without weakening the
  verified server contract.
- No screenshot validation against deployed iPhone/iPad environments was
  performed by this code PR.

## Verification
CI runs UI render tests, API ownership tests and requests checking the
latest revision, explicit cost confirmation and stale selections.
