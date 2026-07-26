# AIBA

AIBA is an agent-native application capability system. It helps AI agents add,
verify, trace, and upgrade cross-cutting application capabilities without
forcing projects into a fixed application framework or visual system.

The initial capability set covers `review-access`, `identity`, `audit`,
`authorization`, `users`, and `notification`. AIBA currently supports
Agent-assisted install, deterministic verification, drift inspection,
customization-aware upgrade, signed capability bundles, authenticated private
registry fetch, verified caching, and anti-rollback resolution. Optional project
governance adds signed, evidence-bound team approvals to install and upgrade
finalization.

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
- `packages/registry-server`: authenticated read-only reference registry.
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
aiba registry-add identity.aiba --registry ./registry \
  --publisher-trust publisher-trust.json
aiba registry-index ./registry --id local-registry \
  --publisher registry-operator --key-id root-1 \
  --private-key ../registry-keys/private.pem \
  --publisher-trust publisher-trust.json --sequence 1 \
  --expires-at 2026-07-27T00:00:00Z
aiba resolve identity --registry ./registry \
  --registry-trust registry-trust.json \
  --publisher-trust publisher-trust.json
AIBA_REGISTRY_TOKEN=... aiba registry-serve ./registry \
  --registry-trust registry-trust.json \
  --publisher-trust publisher-trust.json \
  --tls-cert fullchain.pem --tls-key private.pem
AIBA_REGISTRY_TOKEN=... aiba fetch identity \
  --registry-url https://registry.example.com \
  --registry-trust registry-trust.json \
  --publisher-trust publisher-trust.json
aiba policy-init --id product-team --approver release-manager \
  --key-id root-1 --public-key ../approver-keys/public.pem \
  --capability identity review-access
aiba approve identity --approver release-manager --key-id root-1 \
  --private-key ../approver-keys/private.pem
aiba policy-check identity --agent codex
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
request. `fetch` adds authenticated HTTPS transport and a verified local cache;
the bearer token comes only from a named environment variable, and redirects,
oversized responses, stale indexes, and unverified cache content are rejected.
The default `.aiba/registry-cache/` contains derived artifacts and should not be
committed; keep `.aiba/registry-state.json` in trusted persistent storage.

`registry-add` imports only fully publisher-verified bundles and never replaces
conflicting versions. `registry-serve` verifies the latest signed index and all
indexed bundles before listening, then exposes only authenticated `GET`/`HEAD`
routes. It has no remote mutation or signing API. See
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) for the operating workflow.

When `.aiba/governance-policy.json` exists, `add --finalize` and
`upgrade --finalize` fail closed until valid approvals satisfy the configured
threshold. Each approval signs the exact plan, policy, capability versions, and
current evidence-file hashes. Final receipts retain policy and approval hashes
for later verification.

See [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/TASKS.md](docs/TASKS.md) for
the current implementation status.
