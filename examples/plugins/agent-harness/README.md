# Example Agent harness plugin

This package demonstrates the complete required harness seam: availability,
new-session planning, exact-session resume, and continuity proof. It needs no
changes to Observatory core or the selected `SessionHost` adapter.

The executable and arguments are illustrative. A real plugin must redact
prompts and native conversation references from diagnostics and must never
fall back from exact resume to a latest-session command.
