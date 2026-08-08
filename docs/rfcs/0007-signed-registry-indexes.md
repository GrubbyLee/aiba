# RFC 0007: Signed Registry Indexes And Anti-Rollback

Status: Accepted for M4.2 implementation

## Purpose

Let AIBA resolve publisher-authenticated capability bundles from local or
privately mounted registries without trusting directory names, mutable server
state, or package-provided code.

## Immutable Layout

```text
<registry>/
  indexes/
    <sequence>/
      index.json
      index.sig.json
  bundles/
    <capability>/<version>/
      bundle.json
      bundle.sig.json
      pack/...
```

Each sequence directory is immutable. Writers must create a new positive,
monotonically increasing sequence and must never replace an existing snapshot.
Resolvers select the numerically highest snapshot available.

## Signed Index

The registry operator signs the RFC 8785 canonical JSON form of `index.json`
with Ed25519. Entries are sorted and unique by capability and semantic version.
Each entry binds an exact bundle path, bundle-manifest digest, bundle publisher,
and publisher key ID. Paths must equal
`bundles/<capability>/<version>`; redirects and traversal are not permitted.

Indexes carry generated and expiry timestamps. Expired indexes and indexes
generated unreasonably in the future are rejected. Registry signing trust is
separate from capability publisher trust: a registry may list a bundle, but
only an authorized capability publisher can make that bundle valid.

## Anti-Rollback State

After a registry index and selected bundle verify, Core records the highest
accepted sequence and index digest in a local state file. A lower sequence is a
rollback. Reusing the same sequence with a different digest is equivocation.
Both are rejected. The state file must live in trusted persistent project or CI
storage; deleting it intentionally resets first-use trust.

State advances only after the requested bundle passes publisher trust,
integrity, and semantic validation. This prevents a signed but unusable index
from pinning clients before resolution completes.

## Resolution Boundary

Resolution returns the verified bundle and pack paths. It does not copy project
code, execute files, install dependencies, or weaken `aiba verify-bundle`.
Network transport and hosted registry authentication sit outside this local
cryptographic boundary.
