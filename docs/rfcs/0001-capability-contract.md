# RFC 0001: Capability Contract v0

Status: Accepted for M0 implementation

## Summary

A capability is a versioned set of semantics and invariants that can have many
valid implementations. AIBA verifies conformance through project-owned receipts
and evidence rather than requiring generated source to retain a fixed shape.

## Artifacts

### Capability Manifest

Defines identity, version, required interfaces, dependencies, and invariants.
Each invariant declares severity, acceptable evidence types, and evidence types
that must be present.

### Project Manifest

Declares installed capabilities and the receipt associated with each one. It
may also record detected or confirmed stack metadata.

### Capability Receipt

Records installation provenance and maps each invariant to files that provide
source, test, configuration, or documentation evidence.

## Invariants

An invariant is stable semantic behavior, such as "review access expires". It
must not prescribe a framework, database table, component library, or visual
layout.

M0 verifies that all required invariant attestations exist, evidence paths are
safe and present, evidence types are accepted, and recorded hashes still match.
This is structural provenance verification, not full behavioral proof.

## Security

- Evidence paths cannot escape the project root.
- Capability packs are data-only in M0; AIBA does not execute their commands.
- Duplicate invariant identifiers are rejected.
- Unknown invariants in receipts are rejected.
- Critical missing or stale evidence causes a failed verification.

## Versioning

Schemas use `aiba.dev/v0alpha1`. Capability versions use semantic versioning.
Schema stability is not promised before `v1`, but all breaking changes require
an RFC and a migration path once public fixtures depend on them.
