# RFC 0020: Signed Solution Distribution

Status: Implemented

## Decision

Solutions have an independent Ed25519 signing domain. A signed envelope binds:

- the exact `solution.yaml` SHA-256 and semantic identity;
- publisher and key identities;
- a monotonic publication sequence;
- creation and expiry timestamps.

`solution-verify` requires a project-owned trust policy that allowlists exact
publisher/key/Solution combinations. A key may carry a `revokedAt` timestamp;
signatures created at or after revocation are rejected. Rotation adds a new
trusted key and removes or timestamps the old key.

Optional persistent state records the highest accepted sequence and canonical
envelope hash. Lower sequences are rollbacks. Different envelopes at one
sequence are equivocation. State advances atomically only after schema,
identity, content hash, validity window, trust, revocation, and signature checks
all pass.

Official npm provenance remains valid for the built-in catalog. Independent
signatures are required when a Solution is distributed through a third-party
Registry, mirror, private channel, or future marketplace. Signing authenticates
the composition; every constituent still undergoes normal capability and
project verification.
