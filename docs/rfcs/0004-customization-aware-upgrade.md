# RFC 0004: Customization-Aware Upgrade

Status: Implemented

## Purpose

Allow AIBA to upgrade a capability without assuming that Agent-authored files
remain unchanged or belong exclusively to AIBA. Upgrade is an Agent-assisted,
Core-verified migration rather than a template overwrite.

## Ancestry And Ownership

Finalization records `.aiba/ancestry/<capability>.json`. Each evidence file has
its installation hash, evidence types, invariants, originating operations, and
one ownership class:

- `generated`: introduced for the capability and replaceable only while unchanged.
- `shared`: introduced or adapted for the capability and expected to accumulate project customization.
- `project`: pre-existing project code referenced as evidence and never implicitly replaced.

If an Agent omits ownership, Core uses `shared`, the conservative default.
Ancestry stores hashes and semantics, not source contents or secrets.

## Drift Classes

`aiba diff [capability]` compares current files with installed ancestry:

- `unchanged`: current SHA-256 equals the installation hash.
- `customized`: the file exists but its hash changed.
- `missing`: the recorded path no longer resolves to a project file.
- `source-drift`: the installed capability or recipe differs from lock state.

Customization is information, not verification success. Existing `aiba verify`
continues to reject stale evidence until an upgrade or explicit re-finalization
records a new verified baseline.

## Upgrade Lifecycle

```text
aiba upgrade <capability> --packs-dir <target-pack>
        |
Agent adapts project code and records conflict resolutions/evidence
        |
project tests and capability conformance tests
        |
aiba upgrade <capability> --finalize --packs-dir <target-pack>
```

Preparation records target source hashes, migration operations, initial drift,
and conflicts. Finalization rejects changed immutable plan fields, unresolved
conflicts, insufficient evidence, and failed target verification. It then writes
new receipt, lock, and ancestry state through the same recoverable state update
used by installation.

Core never merges or overwrites business files. The Agent performs semantic
adaptation; Core makes the migration bounded, attributable, and testable.

## Conflict Policy

- Customized `generated` and `shared` files require an explicit `adapt`,
  `preserve`, `replace`, or `remove` resolution with a non-empty rationale.
- Missing generated/shared files require explicit resolution.
- Project-owned customization is expected, but target evidence must still prove
  the upgraded invariants.
- `preserve` must retain the file observed during preparation, `remove` must end
  with an absent file, and all other resolutions must end with a present file.
- A target pack cannot silently change after preparation; all capability,
  recipe, and migration documents are hash-bound.

## M2 Reference Migration

The v2 reference pack at
`fixtures/capability-packs/review-access-v2/` promotes release binding to an
explicit critical invariant. Its migration guides an Agent to enforce the
approved release at authentication and authorization boundaries. Core parses
this guidance as untrusted data and never executes pack-provided commands.
