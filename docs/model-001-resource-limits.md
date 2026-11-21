# MODEL-001 - Resource-bounded Blender scenes

The native `.blend` is authoritative. There are **no fixed object, mesh, vertex or polygon-count ceilings** in Blender's modeling pipeline. Complexity is instead bounded by the isolated Modal Sandbox, processing time, scene metadata size and artifact transfer/storage limits.

## Current resource budgets
- Native BLEND: **256 MiB** per revision artifact (validated before publication).
- Optional GLB preview: **128 MiB**, plus **90 seconds** for export; an unusable or unavailable preview must not discard a valid BLEND. Very large models can still be created but may have no browser preview.
- Scene report: **16 MiB**; object metadata and inspection must fit. Very large numbers of objects may still exceed this budget.
- Scene storage: **256 MiB per file**; archive import/export: **256 MiB compressed ZIP**, **512 MiB sum of expanded artifact bytes**, **256 MiB per archive member**. A multi-revision project beyond these aggregate budgets cannot currently be archived.
- Python source: **64 KiB UTF-8** (checked in service, syntax preflight, trusted controller and Blender process).
- Default modeling Sandbox: **2 CPU cores, 8 GiB RAM, 900 seconds**. These do *not* increase automatically when scenes become larger.
- The archive upload is currently buffered in server memory; the ZIP transfer cap is intentionally lower than the expanded cap. Streaming import can be a separate future improvement.

## Security and fidelity
- Keep immutable revisions, SHA-256 integrity, safe ZIP entries, no network in the sandbox and fixed resource ceilings.
- GLB/Three.js is a preview, not a topology limit or a fidelity guarantee.
- This change neither increases the default paid Modal budget nor launches chargeable jobs.

## Verification
CI Node and Python suites plus headless Blender smoke must pass. Follow up with a large-scene manual acceptance run before changing limits further.
