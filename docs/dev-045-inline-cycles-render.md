# DEV-045 – Optional same-process Cycles image

Blender Workspace normally runs modeling Python inside a new short-lived,
network-blocked owner-funded Modal Sandbox. This change introduces an explicit
`inlineRender: true` input on the existing `workspace_queue_python_script`
tool. The default is off. The existing paid on-demand render path remains.

When enabled, **the same Blender process**:
1. Executes the modeling script, saves `scene.blend`, and generates the optional GLB.
2. Records the original scene metadata before changing its camera or lighting.
3. Creates a **temporary** three-quarter orthographic camera, framing stored
   renderable object bounds to ~78% of the square view; uses a bounded light
   when no scene light exists.
4. Renders **512×512 Cycles CPU, 16 samples** with a **150-second preview
   budget** and the existing two-core/eight-GiB Sandbox ceiling.
5. Saves a validated 512-square PNG as `scene.png` in the same immutable
   revision and displays it in owner-authorized project image galleries.

The saved BLEND is authoritative. An error, timeout or unsuitable scene
during rendering removes only `scene.png`, records
`inlineRender.status=unavailable`, and still publishes the valid BLEND/JSON
and any GLB. Camera, temporary lighting and preview settings are not saved
back to BLEND and are not presented as original scene objects.

The camera uses *stored* object bounding boxes without evaluating modifier
results. Procedural hair, Geometry Nodes, far-away objects, and unusual
visibility settings may still lead to an imperfect crop. The default margin
is deliberate; this is not a promise of ideal composition.

## Observability
The revision `scene.json` stores bounded seconds for model/load, BLEND save,
GLB export, and optional render. The trusted controller adds Sandbox start,
total Blender execution, artifact transfer seconds and a **rough USD compute
estimate**, not a Modal invoice. It does not persist raw stdout/stderr,
credentials or untrusted Python. `scene.png` is hash-verified and served
via a Google-session owner-only endpoint; it is included in portable ZIP
project archives.

## Test gates
- Service, PostgreSQL, Docker and deployment CI.
- Headless real Blender render of a cube, exact PNG dimensions, original
  scene metadata and native BLEND unchanged by temporary camera.
- Injected inline renderer exception verifies a successful modeling revision
  without `scene.png`.
- No Modal credit is consumed by CI. Live performance and billing measurements
  remain deferred until explicitly authorized.
