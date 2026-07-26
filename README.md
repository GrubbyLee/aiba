# AIBA

AIBA is an agent-native application capability system. It helps AI agents add,
verify, trace, and upgrade cross-cutting application capabilities without
forcing projects into a fixed application framework or visual system.

The initial capability set covers `review-access`, `identity`, `audit`,
`authorization`, `users`, and `notification`. AIBA currently supports
Agent-assisted install, deterministic verification, drift inspection,
customization-aware upgrade, signed capability bundles, and anti-rollback local
registry resolution.

## Principles

- Stable capability semantics, flexible implementation.
- Deterministic verification, AI-assisted adaptation.
- Project-owned generated code.
- Traceable changes and upgradeable capabilities.
- Independent core with thin Agent skill adapters.

## Repository

- `docs/`: vision, architecture, RFCs, roadmap, and task progress.
- `packages/spec`: language-neutral schemas and TypeScript protocol types.
- `packages/core`: inspection, capability loading, provenance, and verification.
- `packages/cli`: the `aiba` command-line interface.
- `capabilities/`: official capability packs.
- `integrations/`: Agent-specific adapters.
- `fixtures/`: reference projects used for conformance and attack testing,
  including a native WeChat Mini Program and an integrated core-capabilities
  security corpus.

## Development

```bash
pnpm install
pnpm check
node packages/cli/dist/index.js init /path/to/project
node packages/cli/dist/index.js inspect .
node packages/cli/dist/index.js add review-access --root /path/to/project
node packages/cli/dist/index.js add review-access --finalize --root /path/to/project
node packages/cli/dist/index.js diff review-access --root /path/to/project
node packages/cli/dist/index.js upgrade review-access \
  --root /path/to/project --packs-dir /path/to/target-packs
node packages/cli/dist/index.js upgrade review-access --finalize \
  --root /path/to/project --packs-dir /path/to/target-packs
node packages/cli/dist/index.js verify review-access \
  --root fixtures/review-access-reference \
  --packs-dir capabilities
aiba keygen aiba-official --out ../aiba-publisher-keys
aiba pack identity --publisher aiba-official --key-id root-1 \
  --private-key ../aiba-publisher-keys/private.pem --out identity.aiba
aiba verify-bundle identity.aiba --trust trust-policy.json
aiba registry-index ./registry --id local-registry \
  --publisher registry-operator --key-id root-1 \
  --private-key ../registry-keys/private.pem \
  --publisher-trust publisher-trust.json --sequence 1 \
  --expires-at 2026-07-27T00:00:00Z
aiba resolve identity --registry ./registry \
  --registry-trust registry-trust.json \
  --publisher-trust publisher-trust.json
```

The concise product workflow remains:

```bash
aiba init
aiba add identity
aiba inspect
aiba verify
```

For the complete M3 security base, install and adapt `identity`, `audit`,
`authorization`, `users`, then `notification`; dependency checks prevent an
invalid order. Each `add` prepares an Agent plan and each `--finalize` records
Core-computed provenance after project tests pass.

`add` and `upgrade` prepare a bounded plan by default. An Agent adapts the
project and supplies evidence or conflict resolutions; Core then hashes and
verifies the result during `--finalize`. Capability packs are treated as data
and cannot provide commands for Core to execute.

`registry-index` creates an immutable signed snapshot after verifying every
listed publisher bundle. `resolve` verifies the latest registry snapshot, its
expiry, local anti-rollback state, and the selected bundle before returning its
paths. Registry resolution performs no install, code execution, or network
request.

See [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/TASKS.md](docs/TASKS.md) for
the current implementation status.
