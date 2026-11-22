# DEV-051 – GLB animation video without Modal

The existing authenticated Three.js GLB viewer now exposes a compact
**Exportera video** section, only when the GLB has animation clips.
It offers MP4 (H.264) and WebM (VP8/VP9) **only when**
`MediaRecorder.isTypeSupported` confirms the corresponding encoder.
MP4 is shown first, if available, for convenient iPad playback.

## Browser export

- Start from the selected clip's time 0 and play it **once**, not looped.
- Capture the **current camera angle** with the existing scene, lighting,
  materials and clip animation in a separate 1280×720 Three.js canvas.
- Capture 30 fps (target) and encode in real time with
  `canvas.captureStream(30)` and `MediaRecorder`.
- After recording finishes, users can **Spara video** as a local MP4/WebM
  or **Dela video** using native File sharing where supported.
- `Avbryt` stops recording, releases tracks/GPU resources and restores
  the prior animation position. Leaving the page or switching tabs during
  capture also cancels recording.
- No calls to Modal, Blender, video backend or third-party service. No
  credentials, videos or source models are uploaded.
- Bound clips to **120 seconds** and output to **128 MiB** in memory.
  Output container magic is checked to avoid creating a file with the wrong
  extension.

## Performance and compatibility

Actual frame rate may drop below 30 fps if rendering or encoding is too
slow; this first version records at wall-clock speed instead of generating
an offline deterministic image sequence. The video has no audio.
Native playback and file sharing vary by browser/OS. There is no claim
that every device supports MP4; WebM will be shown when supported.
Some browser builds do not support recording canvas streams at all; in
that case the UI shows a clear message and never starts the export.

The GLB viewer cannot reproduce native Blender-only hair, procedural
nodes or Cycles lighting. Use Blender rendering when high-fidelity video
is needed.

## Verification

Offline unit tests mock the recording backend to validate exact start,
completion, video format discovery, codec/container consistency, size and
duration limits, cancellation, and generated viewer controls. No Modal
job or external encoder is used in CI.

**Live acceptance on iPad:** Select a short GLB animation, open
Exportera video, select an available format, export, play and save/share
the resulting video. Confirm correct camera framing and check whether
30 fps is maintained. Test iPad portrait and landscape. Keep video
short for the initial performance evaluation.
