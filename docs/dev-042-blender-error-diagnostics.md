# DEV-042 — User-visible Blender job diagnostics and hair regression

## Failure contract
The Modal controller continues to capture bounded Blender stdout/stderr in
memory to classify failures. It does not persist or expose raw Blender
stdout/stderr, user Python source, free-form exception messages or file paths.
The existing failed-job `error_message` column persists only allowlisted
`BW_JOB_ERROR` metadata: phase, code, optional exact exit code, Python exception
class and user-source line. These are available in `workspace_get_job` after
owner check, and translated to readable Swedish in the web job history.

Blender process exit: Python script exceptions report `python_script_error`
only when Blender's trusted entry point emits a validated line/type marker.
A positive nonzero exit without evidence is still `blender_execution_failed`.
A signal-terminated process is `blender_crash`; SIGKILL/137 on its own does
NOT imply OOM. OOM is used only when explicit Blender or provider evidence
reports memory exhaustion. Provider timeout is classified separately. Full
provider error strings never cross the worker boundary.

Exporting GLB remains optional: a failure of the preview must not discard a
valid authoritative BLEND revision. If native artifact validation fails, the
existing artifact-check codes remain authoritative. CLI output tails and SDK
error text remain unavailable via MCP or the browser intentionally.

## Regression
- Unit tests assert safe classification, redaction, line and exit propagation,
  and rejection of injected labels and untrusted historical error text.
- Headless Blender smoke creates a mesh sphere and modern native hair curves,
  grows a bounded hair density parameter, saves/reopens .blend; native hair
  fidelity is not made dependent on GLB support.
- No tests start owner-billed Modal Sandbox jobs. Live checks must be explicitly
  approved as chargeable work.

## Limitations
The selected hair test is synthetic and does not establish the cause of the
historical cat failure. A traceback marker captures Python exception *type*
and the last source-code line, not the exception message or full traceback;
this is a deliberate privacy and security trade-off. External SDKs may not
expose resource-limit reason, so some failures remain unclassified.
