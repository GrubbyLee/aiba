# RFC 0013: Capability Solution Composition

Status: Accepted

## Context

Industry products need several AIBA capabilities, but a large template would
reintroduce framework lock-in and could hide weakened security requirements.
Composition must remain useful to Agents while preserving independent Core
verification of every constituent.

## Decision

A `CapabilitySolution` contains an ordered list of exact capability IDs,
versions, manifest SHA-256 values, and human-readable purposes. The list must be
unique and contain the complete closure of every non-optional dependency. A
dependency must satisfy the consumer's declared SemVer range and appear before
that consumer.

The schema deliberately provides no scripts, commands, invariant overrides,
ignored-invariant lists, version ranges, or dependency optionality. Core treats
solution files and packs as untrusted data, validates both, checks every pinned
manifest byte hash, and then calls ordinary project verification separately for
each constituent. Extra project capabilities do not make a valid solution fail,
but missing, mismatched, stale, or unverified required constituents do.

`aiba compose <solution>` is a read-only readiness check. It reports exact
installation order and per-capability diagnostics; normal `aiba add` and
`--finalize` remain the only installation workflow.

## Distribution Trust

Official solutions ship in the npm CLI package covered by the repository's OIDC
provenance release process. This authenticates the distributed package, while
manifest hashes bind its solution graph to exact capability bytes. A standalone
solution signature and publisher trust-policy protocol remains required for
independent registry distribution and is not implied by this RFC.

## Consequences

Solutions stay small, deterministic, and framework-neutral. Agents can adapt UI,
database, transport, and deployment independently, but cannot turn a failing
constituent into a passing product composition. Adding or upgrading a capability
requires a new solution version and new pinned hash.
