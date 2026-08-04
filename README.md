<p align="center">
  <img src="docs/assets/aiba-logo.svg" width="760" alt="AIBA - Agent Infrastructure for Building Applications">
</p>

<p align="center">
  <strong>Infrastructure for agent-built software.</strong>
</p>

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@grubbylee/aiba"><img src="https://img.shields.io/npm/v/@grubbylee/aiba?color=ff4a2b" alt="npm version"></a>
  <a href="https://github.com/GrubbyLee/aiba/actions/workflows/ci.yml"><img src="https://github.com/GrubbyLee/aiba/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-151412" alt="AGPL-3.0-only"></a>
</p>

# AIBA

**Agent Infrastructure for Building Applications.**

AIBA is application-building infrastructure for AI agents. It helps agents add,
verify, trace, and upgrade complete software capabilities without forcing
projects into a fixed application framework, provider, or visual system.

The initial capability set covers `review-access`, `identity`, `audit`,
`authorization`, `users`, `notification`, `file-assets`, `import-export`, and
`vehicle-records`. `wechat-miniprogram-auth` is the first provider-facing
platform integration.
The catalog grows through five layers: application foundations, platform
integrations, reusable business capabilities, engineering governance, and
composed industry solutions.
AIBA currently supports Agent-assisted install, deterministic evidence and provenance verification,
drift inspection, customization-aware upgrade, signed capability bundles,
authenticated private registry fetch, verified caching, and anti-rollback
resolution. Optional project governance adds signed, evidence-bound team
approvals to install and upgrade finalization.

[Watch the vehicle-management walkthrough](https://grubbylee.github.io/aiba/video/) to see AIBA and
Codex move from an empty directory to a working, independently verified admin
application.

## Principles

- Stable capability semantics, flexible implementation.
- Deterministic evidence and provenance verification, AI-assisted adaptation.
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
- `solutions/`: exact, dependency-ordered industry capability compositions.
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
node packages/cli/dist/index.js compose vehicle-management \
  --root fixtures/identity-reference --packs-dir capabilities
node packages/cli/dist/index.js add vehicle-management --solution \
  --root /path/to/project
node packages/cli/dist/index.js add vehicle-management --solution --finalize \
  --agent codex --root /path/to/project
node packages/cli/dist/index.js add wechat-miniprogram-auth \
  --root /path/to/project
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

## Install

After the first npm release:

```bash
npm install --global @grubbylee/aiba
aiba list
aiba show identity
aiba init
aiba add vehicle-management --solution
aiba status vehicle-management
aiba continue vehicle-management
aiba continue vehicle-management --finalize --agent codex
aiba doctor
aiba inspect
aiba compose vehicle-management
aiba test identity --runner ci-runner --key-id runner-1 \
  --test-id identity-contract --command "pnpm test -- identity"
aiba attest .aiba/behavior/challenges/<id>.json \
  --private-key /secure/runner-private.pem \
  --started-at <date-time> --completed-at <date-time> \
  --exit-code 0 --summary test-results/identity.json
aiba verify-behavior .aiba/behavior/proofs/<id>.json \
  --trust runner-trust.json --command "pnpm test -- identity" \
  --summary test-results/identity.json
```

The scoped package still installs the `aiba` executable. The npm distribution
includes the official capability packs and industry solutions. Library consumers
can install `aiba-core`, `aiba-spec`, or `aiba-registry-server` independently.

## License

The CLI, Core, Registry Server, capability contracts, recipes, and migrations
are AGPL-3.0-only. The protocol package is Apache-2.0. Some application output
may use the additional permission in
[GENERATED_OUTPUT_EXCEPTION.md](GENERATED_OUTPUT_EXCEPTION.md); this exception
does not relicense AIBA itself or third-party material.

The concise product workflow remains:

```bash
aiba init
aiba list
aiba show vehicle-management
aiba add vehicle-management --solution
aiba inspect
aiba verify
aiba compose vehicle-management
```

For the complete M3 security base, install and adapt `identity`, `audit`,
`authorization`, `users`, then `notification`; dependency checks prevent an
invalid order. Each `add` prepares an Agent plan and each `--finalize` records
Core-computed provenance after project tests pass.

`add` and `upgrade` prepare a bounded plan by default. An Agent adapts the
project and supplies evidence or conflict resolutions; Core then hashes and
verifies the result during `--finalize`. Capability packs are treated as data
and cannot provide commands for Core to execute.

`compose` is a read-only evidence and provenance check. A solution pins every constituent to
an exact version and manifest hash, requires a complete dependency closure in
installation order, and runs normal project verification for every capability.
It cannot mark a required dependency optional or ignore a constituent invariant.

`add <solution> --solution` is the guided installation path. It prepares or
finalizes exactly one constituent per invocation. The Agent implements the
returned plan and adds evidence, then runs `--finalize --agent <name>` before
requesting the next step. Core re-verifies installed constituents before it
advances and runs full Solution evidence and provenance verification after the last capability.

An evidence `ok` result means declared evidence, source hashes, receipts,
ancestry, dependencies, and governance provenance are valid and unchanged; it
does not claim project tests ran. Trusted runtime claims use the separate
challenge-based `test` / `attest` / `verify-behavior` protocol. Core never
executes the bound command. See [RFC 0017](docs/rfcs/0017-trusted-behavior-proofs.md).

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
the current implementation status. Compatibility and release details live in
[docs/VERSIONING.md](docs/VERSIONING.md) and
[docs/RELEASING.md](docs/RELEASING.md). M7 cross-surface evidence is summarized
in [docs/PORTABILITY.md](docs/PORTABILITY.md).
