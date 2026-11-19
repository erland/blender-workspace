# DEV-031 — browser-only GLB visual inspection

## Decision

Do **not** add server-side Blender rendering for interactive model inspection.
Build on the existing authenticated, same-origin GLB browser viewer. All
camera moves, visual overlays and PNG encoding run in the user's browser,
using Three.js/WebGL. They **do not** create a Modal job, use a GPU in Modal,
change the immutable revision, or change backend routes.

## Viewer improvements

- Deterministic, Y-up GLB camera presets: isometric, front, back, left, right
  and top. All use the already loaded model's world-space bounds and adjust
  their camera distance for both landscape and portrait canvas aspect ratios.
- Optional read-only visual aids: model bounding box, world-coordinate axes,
  and wireframe material display. Controls apply to the primary model and
  to the revision-comparison pane. Wireframe restores each original material
  state on disable or revision replacement. Selection remains independent.
- The existing local PNG screenshot button is clarified as **Exportera PNG**.
  It captures the current main viewport at the current canvas resolution,
  including selected visual aids and camera angle. The suggested filename
  contains revision number and camera preset. Nothing is uploaded.
- Existing signed Google cookie, per-owner GLB/revision checks,
  same-origin CSP and read-only viewer remain unchanged.

## Scope and limitations

- This is **client-side WebGL**, not Blender Cycles/Eevee rendering.
- PNG capture is of the primary model pane, not the comparison pane.
- PNG size depends on CSS canvas size and device pixel ratio (capped at 2);
  image generation in a browser can fail if WebGL or canvas export is
  unsupported. The UI reports failed exports.
- The top view follows the viewer's **Y-up glTF axes**. Blender Z-up scenes
  are converted by the standard glTF pipeline.
- Wireframe is a visual mode, not an editing mode; it does not modify the
  loaded GLB or the saved scene.
- On very large models, WebGL frame rate, device memory and PNG canvas size
  are limited by the user's device. No server compute is consumed.
- Images are saved locally through the browser's download mechanism.
  ChatGPT does not automatically receive or analyze the generated PNG.
  A separate, explicit image handoff would be required for agent feedback.
- A real-world browser/iPad visual acceptance test remains deferred.

## Verification

- `service/__tests__/viewer-visual-inspection.test.mjs` tests all presets,
  camera framing in portrait/landscape, public control IDs and lack of
  client-side Modal calls.
- `service/__tests__/viewer.test.mjs` continues to test session protection,
  cross-origin blocking, project ownership and SHA-256-verified GLB responses.
- `.github/workflows/viewer-dev031.yml` builds the actual browser bundle,
  runs both test files and confirms no embedded Modal credentials.

This step incurs **zero additional Modal rendering cost**.
