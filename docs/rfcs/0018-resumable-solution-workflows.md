# RFC 0018: Resumable Solution Workflows

Status: Implemented

## Decision

AIBA derives workflow state from the Project Manifest, Lock, receipts, exact
Solution graph, verified installed constituents, and a validated pending plan.
It does not persist a second mutable workflow database.

- `aiba status <solution>` is read-only and reports `ready-to-prepare`,
  `awaiting-agent`, or `complete`.
- `aiba continue <solution>` prepares at most one missing constituent.
- `aiba continue <solution> --finalize` explicitly verifies and records only
  the current constituent.
- `aiba doctor` inspects project initialization, protocol state, evidence,
  provenance, and genuinely pending plans.

Repeated commands are safe: an existing valid plan is returned rather than
recreated. A stale or modified plan, invalid installed constituent, wrong exact
version, missing receipt, or evidence drift fails before workflow advancement.

## Safety Boundary

`continue` does not run an Agent, execute recipe commands, or finalize without
the explicit flag. The Agent remains responsible for adapting project-owned
code and submitting evidence. Core remains the sole authority that validates
the plan and records installation state.
