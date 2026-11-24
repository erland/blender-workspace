# Fix: acknowledged Modal cancellation incorrectly became needs_recovery

The November 24 controlled acceptance test completed normal modeling successfully,
but requesting cancellation of a long-running model job ended in
`needs_recovery / sandbox_cleanup_failed`. The owner subsequently confirmed
that no Modal Sandbox was still running.

## Root cause and fix

The Node worker's controller-acknowledgement regular expression used escaped
backslash sequences (`\\n`) rather than actual line boundaries in its
regular-expression literal. Consequently, a genuine trusted `BW_CANCELLED`
line on stderr was not recognized.

The parser now matches a complete `BW_CANCELLED` line with either LF or CRLF.
The unconfirmed path remains strict: exit without that marker is never treated
as confirmed termination.

The controller's 12-second SIGTERM grace was also shorter than Modal's
`Sandbox.terminate(wait=True)` completion in some environments. Grace is
extended to 90 seconds before hard-kill; the fixed 18-minute controller runtime
limit remains. The extra grace applies only after explicit cancellation,
not to normal modeling.

## Tests

Two Node integration-style tests launch a local fake Python controller,
exercise the actual Node spawn, pipe parsing and SIGTERM handling, and verify:
- A CRLF-delimited `BW_CANCELLED` line produces `JobCancelledConfirmed`.
- The same interrupted controller without the acknowledgement produces
  `JobCancellationUnconfirmed`.

No Modal Sandbox is started by either test.

## Limitations

A hung or unreachable Modal API can still cause termination uncertainty.
A forced SIGKILL cannot prove the provider has stopped; preserve
`needs_recovery` and inspect Modal when needed. This patch does **not**
retroactively change the November 24 job state, because that would require
independent proof tied to its actual provider execution.
