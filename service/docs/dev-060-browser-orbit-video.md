# DEV-060 – 360° browser video export

Scope: preserve DEV-051 animation video export and add a 360° camera orbit
for static and animated GLB revisions. Both the authenticated owner viewer and
the public shared viewer use the same browser-only Three.js/MediaRecorder engine.

- Orbit begins at the current camera position around the current OrbitControls
  target, retaining height and distance. A strictly top-down camera cannot
  produce a visible orbit and is rejected with a helpful message.
- Durations: 10, 15, 30, 60 seconds; constant angular speed.
- Export resolution: 1280×720 or 1920×1080; target 30 fps.
- MP4/H.264 or WebM/VP8/VP9 selected only when browser encoding is supported.
- Existing 120-second and 128 MiB caps and byte-level container checks apply.
- The selected GLB animation may be exported once through; the 360° orbit
  preserves the currently displayed animation pose and does not play it.
- No freehand camera capture, external service, Modal, or server video API.
- Capture resources are disposed after success, failure, cancellation or exit.
- File saving and optional native file sharing remain local to the browser.
- Blender-only Cycles, particle hair and procedural nodes are not reproduced.

## Verification

`cd service && npm test`: unit and interface regression tests for rotations,
codec guards, container validation, cancellation, and both viewer shells.

**Deferred live acceptance:** After release, use a static castle GLB and an
animated GLB in authenticated and public viewers; verify full 360° videos
at 720p/1080p, video playback MP4 or WebM on supported devices, and browser
cancellation in iPad portrait/landscape. Actual frame rate and codec support
depend on the device/browser and are not guaranteed by unit tests.
