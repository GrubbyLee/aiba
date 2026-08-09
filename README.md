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

AIBA is the infrastructure layer that addresses all three.

## What AIBA does

AIBA is **agent-native capability infrastructure**. It is not an admin template,
visual page builder, fixed full-stack framework, or prompt library.

Instead of forcing one stack, AIBA gives every AI Agent stable, versioned
definitions of application behavior. The Agent adapts that behavior to the
project's existing stack and design language; deterministic Core commands
inspect, verify, trace, and upgrade the result. Generated code stays owned by
the project.

In one sentence: **AIBA turns AI-generated code into governed, traceable,
upgradable production software.**

## What you get on day one

- **A trustworthy admin or internal tool**, built with your stack and your
  design system, without locking into one template.
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

AIBA ships **23 capability packs** (installable behavior contracts) and one
**application solution** (a reusable, dependency-ordered composition of packs).
A pack defines what must be true; a solution defines a verified combination.
Packs are organized in five layers:

| Layer | Highlights |
| --- | --- |
| Application foundation | `identity`, `authorization`, `users`, `audit`, `file-assets`, `notification`, plus data-dict, i18n, feature-flags, inbox, verification-challenge, scheduled-jobs, organization, search, review-access |
| Platform integration | `webhooks`, `wechat-miniprogram-auth` |
| Business capability | `form-engine`, `import-export`, `reporting`, `workflow-approval`, tags, comments-activity |
| Engineering governance | `audit` (also listed under foundation when used as a base layer) |
| Application solution | `secure-workspace` — the six foundational packs composed in verified order |

Browse the full catalog with `aiba list`. Inspect any pack with `aiba show <id>`.

AIBA currently supports agent-assisted install, deterministic evidence and
provenance verification, drift inspection, customization-aware upgrade, signed
capability bundles, authenticated private registry fetch, verified caching, and
anti-rollback resolution. Optional project governance adds signed, evidence-bound
team approvals to install and upgrade finalization.

## Three ways AIBA shows value fast

1. **A Blueprint plan in one CLI pass.** Describe your app once in a YAML file
   and get a deterministic capability dependency graph plus a bounded agent
   task list — no prompt engineering required.
2. **Your first verified capability in the first session.** Pick one building
   block, let the agent adapt it to your stack, then verify evidence and
   provenance before you ship.
3. **Upgrades that respect your custom code.** When a new version of a
   capability ships, AIBA classifies additive, breaking, security-sensitive,
   and conflicting changes — so you only adapt what's necessary.

A [historical external demonstration](https://grubbylee.github.io/aiba/video/)
shows AIBA and Codex building one project from an empty directory. Its example
domain is documentation only and is not part of AIBA's protocol or catalog.

## Start here

Install (requires Node.js 22+):

```bash
npm install --global @grubbylee/aiba
aiba --version
```

Then try the shortest loop:

```bash
aiba init
aiba create app my-app
aiba plan applications/my-app/app.yaml
aiba add identity
aiba add identity --finalize --agent codex
aiba verify .
```

More paths:

- **Step-by-step guide:** [Quick Start](docs/QUICKSTART.md)
- **Production playbook:** [Five-step best practice](docs/BEST_PRACTICE.md)
- **How it works under the hood:** [Capability Model](docs/CAPABILITY_MODEL.md)
- **For teams:** private registry, governance, behavior proofs — start with
  [Self-Hosting](docs/SELF_HOSTING.md)

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

## How it works

The shortest loop: describe, plan, adapt, verify, upgrade.

```bash
aiba init
aiba create app my-app
aiba plan applications/my-app/app.yaml
aiba add identity
aiba add identity --finalize --agent codex
aiba verify .
```

`add` and `upgrade` prepare bounded operation plans — they do not silently
generate code or execute pack content. The agent adapts the capability to the
project's stack and design system; Core hashes evidence and records provenance
only after verification passes. Capability packs are untrusted data; Core never
executes commands from a pack.

`compose` is read-only evidence and provenance verification. A Solution pins
each constituent to an exact version and manifest hash, requires a full
dependency closure and correct install order, and re-runs every capability's
own verification. A Solution can never weaken an invariant or hide a failed
constituent.

Approvals are fail-closed by default when a governance policy is present.
Every approval is bound to the exact plan, policy, capability version, and
evidence-file hashes; the final receipt preserves policy and approval hashes
for later verification.

For runtime behavior claims, use the separate signed `test`, `attest`, and
`verify-behavior` flow. Core never executes tests, but it can verify that a
trusted runner ran them against the right source snapshot.

More detail: [Capability Model](docs/CAPABILITY_MODEL.md),
[Self-Hosting](docs/SELF_HOSTING.md), [Roadmap](docs/ROADMAP.md).
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
