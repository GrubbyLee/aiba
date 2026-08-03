# RFC 0015: Guided Solution Installation

- Status: Accepted
- Date: 2026-08-04

## Context

A `CapabilitySolution` defines an exact, dependency-ordered composition, but
`aiba compose` is deliberately read-only. Requiring an Agent to manually copy
the reported order into a sequence of capability commands creates avoidable
coordination errors. Generating every plan at once would be worse: later plans
would be prepared against project state that does not yet contain their required
dependencies, and could hide each capability's independent trust boundary.

## Decision

Add a guided form of the existing command:

```bash
aiba add <solution> --solution
aiba add <solution> --solution --finalize --agent <name>
```

Each invocation advances at most one constituent. Core validates the Solution
and its content hashes, rejects installed version mismatches, and verifies every
installed constituent before selecting the first missing one. Preparation
creates only that capability's ordinary operation plan. If the exact plan
already exists, Core validates its source hashes, project identity, write scope,
operations, and evidence contract before reporting `awaiting-finalization`.

Finalization delegates to the ordinary capability lifecycle. Governance,
evidence validation, source hashes, ancestry, receipt creation, rollback, and
post-write evidence and provenance verification remain per-capability.
Completing the final constituent returns `evidence-verified` after a full
Solution check; it does not claim behavioral proof.

## Security Invariants

- Solution order and exact constituent versions cannot be overridden.
- Installed evidence drift blocks preparation and finalization of later steps.
- A pending plan cannot be resumed after contract or source tampering.
- Project-owned capabilities outside the Solution do not alter its state.
- Recipes remain untrusted data and Core executes no pack-provided command.
- `--recipe` selects only the current preparation step.

## Consequences

Agents receive a short resumable workflow without turning a Solution into a
monolithic installer. Installation takes multiple explicit Agent turns, which
is intentional: each capability can be implemented, tested, approved, and
independently verified before the next trust boundary is introduced.
