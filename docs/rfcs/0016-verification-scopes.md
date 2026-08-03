# RFC 0016: Verification Scopes

- Status: Accepted
- Date: 2026-08-04

## Context

AIBA Core currently validates contracts, evidence mappings, paths, hashes,
receipts, ancestry, dependencies, and governance provenance. It deliberately
does not execute pack-provided commands. Calling this result simply "verified"
can be mistaken for proof that project tests ran or that arbitrary application
behavior satisfies every invariant.

## Decision

Every project and Solution verification report declares:

```json
{ "scope": "evidence-and-provenance" }
```

Guided Solution installation terminates with `evidence-verified`, not
`complete`. Within this scope, `ok` means the declared evidence and provenance
are structurally valid, content-bound, and unchanged. It is not behavioral
proof. CLI output, Agent guidance, and product documentation must preserve this
distinction.

Source and smoke fixtures must use real implementation and test evidence rather
than placeholder files, even though Core does not execute those tests.

## Future Behavioral Proof

A separate protocol is required before AIBA may report behavioral conformance.
It must bind the capability and invariant IDs, trusted test-corpus version,
implementation and test hashes, authorized execution environment, command or
runner identity, exit result, and timestamp. It must not execute commands sourced
from an untrusted capability pack, and it must use a distinct status and report
field so evidence verification cannot be confused with behavioral proof.
