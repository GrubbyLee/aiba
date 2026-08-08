<p align="center">
  <img src="docs/assets/aiba-logo.svg" width="760" alt="AIBA - Agent Infrastructure for Building Applications">
</p>

<p align="center">
  <strong>The control plane for software built by AI agents.</strong>
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

## The problem

Agents write code fast. Every project still rewrites identity, permissions,
audit, files, notifications, review access, approvals, forms, reporting, and
ten other cross-cutting capabilities.

Teams quickly hit three walls:

- **Trust**: you can't prove the AI-built code is safe, compliant, or upgradable.
- **Speed**: each project starts from a template that must be re-customized
  until it's unrecognizable — and then you can no longer upgrade it.
- **Governance**: there is no system of record for what the agent changed, why
  it changed it, whether the evidence still holds, or who approved it.

AIBA is the infrastructure layer that fixes all three.

## What AIBA does

AIBA is **agent-native low-code infrastructure**. It is not an admin template,
visual page builder, fixed full-stack framework, or prompt library.

Instead of forcing one stack, AIBA gives every AI Agent stable, versioned
definitions of application behavior. The Agent adapts that behavior to the
project's existing stack and design language; deterministic Core commands
inspect, verify, trace, and upgrade the result. Generated code stays owned by
the project.

In one sentence: **AIBA turns AI-generated code into governed, traceable,
upgradable production software.**

## What you get on day one

- **A trustworthy admin or internal tool** in days, not months — without
  locking into one template.
- **23 verified building blocks** for identity, access, files, notifications,
  forms, reports, approvals, i18n, data dictionaries, inboxes, tags, workflows,
  webhooks, audit, and WeChat mini-program review mode.
- **Deterministic evidence & provenance**: every capability installation is
  hashed, traced, and reproducible.
- **Customization-aware upgrades**: you can change the code, and AIBA still
  upgrades the capability on top of your changes.
- **Signed team governance**: approvals are bound to exact plans and evidence
  hashes; tampered plans fail.
- **A registry and private distribution path** for teams that need to control
  every capability they install.

## For whom

- **Independent developers & small teams** who use Codex, Claude Code, or other
  agents and want to ship faster without accumulating unmaintainable AI code.
- **Product teams** who need to build multiple internal tools or back offices
  with shared security, compliance, and upgrade guarantees.
- **Platform & security teams** who need a governance layer for AI-generated
  application code — what changed, who approved it, whether it still verifies,
  and how to upgrade it safely.

AIBA starts with the agent-first developer workflow and scales up to the
enterprise control plane. The same Core, contracts, and verification engine
work from a solo side project to a regulated team.

## Capability layers

AIBA ships 23 reusable capabilities, organized for discovery in this order:

| Layer | Current catalog |
| --- | --- |
| Application foundation | `identity`, `authorization`, `users`, `notification`, `inbox`, `verification-challenge`, `data-dict`, `file-assets`, `i18n`, `scheduled-jobs`, `feature-flags`, `organization`, `search`, `review-access` |
| Platform integration | `webhooks`, `wechat-miniprogram-auth` |
| Business capability | `comments-activity`, `form-engine`, `import-export`, `reporting`, `tags`, `workflow-approval` |
| Engineering governance | `audit` |
| Application solution | `secure-workspace` |

The first four layers are installable packs. The solution layer is a reusable
composition, not one of the 23 capability packs.

AIBA currently supports agent-assisted install, deterministic evidence and
provenance verification, drift inspection, customization-aware upgrade, signed
capability bundles, authenticated private registry fetch, verified caching, and
anti-rollback resolution. Optional project governance adds signed, evidence-bound
team approvals to install and upgrade finalization.

## Three ways AIBA shows value fast

1. **Blueprint plan in under 10 minutes.** Describe your app once, get a
   deterministic capability graph and a bounded agent task list — no prompt
   engineering required.
2. **First verified capability in under an hour.** Pick a building block, let
   the agent adapt it, then verify evidence and provenance before you ship.
3. **Upgrades that don't break your custom code.** When a new version of a
   capability ships, AIBA classifies additive, breaking, security-sensitive,
   and conflicting changes so you only adapt what's necessary.

A [historical external demonstration](https://grubbylee.github.io/aiba/video/)
shows AIBA and Codex building one project from an empty directory. Its example
domain is documentation only and is not part of AIBA's protocol or catalog.

## Get started

- **Best practice**: [Five-step production path](docs/BEST_PRACTICE.md) — the
  recommended way to adopt AIBA for real projects.
- **Quick start**: [Ten-minute setup](docs/QUICKSTART.md) — verify the npm CLI
  in a clean project and hand the first bounded plan to an agent.
- **Deep dive**: [Capability Model](docs/CAPABILITY_MODEL.md) — complete
  catalog, composition rules, agent workflow, and trust boundaries.
- **For teams**: [Enterprise & governance path](docs/BEST_PRACTICE.md#enterprise-path) —
  signed approvals, private registry, and audit-ready provenance.

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
- `solutions/`: exact, dependency-ordered application capability compositions.
- `integrations/`: Agent-specific adapters.
- `fixtures/`: reference projects used for conformance and attack testing,
  including a native WeChat Mini Program and an integrated core-capabilities
  security corpus.

## Install

Requires Node.js 22 or newer:

```bash
npm install --global @grubbylee/aiba
aiba --version
```

The scoped package installs the `aiba` executable and ships the official
capability packs and application solutions. Library users can install
`aiba-core`, `aiba-spec`, or `aiba-registry-server` separately.

Try the shortest path:

```bash
aiba init
aiba create app my-app
aiba plan applications/my-app/app.yaml
aiba add identity
aiba add identity --finalize --agent codex
aiba verify .
```

More entry points:

- Build a full secure foundation: `aiba add secure-workspace --solution`
- Browse the catalog: `aiba list`, `aiba show <id>`
- Follow the five-step production path:
  [Best Practice](docs/BEST_PRACTICE.md)
- For teams: signed governance, private registry, behavior proofs, and
  self-hosting — start with the
  [Capability Model](docs/CAPABILITY_MODEL.md) and
  [Self-Hosting](docs/SELF_HOSTING.md) guides.

## How it works

The shortest product loop:

```bash
aiba init
aiba agent-protocol --json
aiba create app my-app
aiba plan applications/my-app/app.yaml
aiba list
aiba show secure-workspace
aiba add secure-workspace --solution
aiba inspect
aiba verify
aiba compose secure-workspace
```

The full secure foundation installs `identity`, `audit`, `authorization`,
`users`, and `notification` in dependency order; the dependency checker
refuses wrong order. Every `add` first produces a bounded agent plan. Core
records the computed provenance only after project tests pass and
`--finalize` is called.

`add` and `upgrade` prepare bounded operation plans by default. The agent
adapts the project and submits evidence or conflict resolutions; Core hashes
and verifies during `--finalize`. Capability packs are always treated as data
and can never supply commands for Core to execute.

`compose` is a read-only evidence and provenance check. A Solution binds each
constituent to an exact version and manifest hash, requires a full dependency
closure and correct install order, and re-runs each capability's own project
verification. A Solution cannot turn required dependencies optional, and it
cannot bypass any constituent invariant.

`add <solution> --solution` is the stepwise install entry point. Each call
prepares or finalizes only one constituent. After the agent implements the
returned plan and records evidence, run `--finalize --agent <name>`, then
ask for the next step. Core re-verifies all installed constituents before
advancing, and automatically runs the full Solution evidence and provenance
check after the last one finalizes.

AIBA returning `ok` does not mean project tests have been run or runtime
behavior has been proven. It means the declared evidence, provenance hashes,
receipts, ancestry, dependencies, and governance records are valid and
unchanged. To prove runtime behavior, use the separate signed `test`,
`attest`, and `verify-behavior` flow; Core never executes the test
command itself.

`registry-index` validates every publisher capability bundle before creating
an immutable signed snapshot. `resolve` verifies the latest registry snapshot,
expiry, local anti-rollback state, and the selected capability bundle before
returning a path; it never installs code, executes commands, or makes network
requests. `fetch` adds authenticated HTTPS transport and verified caching on
top, and rejects redirects, oversized responses, stale indexes, and unverified
cache contents. The default `.aiba/registry-cache/` is generated output and
should not be committed; keep `.aiba/registry-state.json` in trusted durable
storage.

`registry-add` only imports fully verified publisher bundles and never
overwrites conflicting versions. `registry-serve` validates the latest signed
index and all bundles before listening, then exposes only authenticated
`GET`/`HEAD` routes — no remote modification or signing APIs. See the
[Self-Hosting Guide](docs/SELF_HOSTING.md) for the full flow.

When `.aiba/governance-policy.json` exists, `add --finalize` and
`upgrade --finalize` are fail-closed: only valid approvals meeting the
threshold can proceed. Each approval is bound to the exact plan, policy,
capability version, and current evidence file hashes; the final receipt
preserves policy and approval hashes for later verification.

Current implementation status: [Roadmap](docs/ROADMAP.md) and
[Task List](docs/TASKS.md). Compatibility and release rules:
[Versioning](docs/VERSIONING.md) and [Releasing](docs/RELEASING.md).
Cross-surface adaptation evidence: [Portability](docs/PORTABILITY.md).


## Development

For contributors working inside this monorepo:

```bash
pnpm install
pnpm check
pnpm aiba -- inspect .
```

`pnpm check` runs typecheck, tests, build, smoke, release-metadata validation,
workflow validation, and a clean-tarball consumer test.

Use `pnpm aiba -- <command>` to run the locally built CLI against any path.
Registry operations, signing, governance, and behavior-proof workflows are
covered by the dedicated guides under `docs/`.

## License

The CLI, Core, Registry Server, capability contracts, recipes, and migrations
are AGPL-3.0-only. The protocol package is Apache-2.0. Some application output
may use the additional permission in
[GENERATED_OUTPUT_EXCEPTION.md](GENERATED_OUTPUT_EXCEPTION.md); this exception
does not relicense AIBA itself or third-party material.
