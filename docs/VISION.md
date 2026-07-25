# AIBA Vision

## Product Definition

AIBA is not an admin template, a fixed full-stack framework, or a prompt
collection. It is an independent, agent-native capability system that allows
AI agents to install common application capabilities into existing projects
while preserving project architecture, visual language, and code ownership.

The initial audience is WeChat Mini Program developers and AI-assisted
independent developers. The capability model must remain compatible with later
enterprise use cases.

## Problem

AI makes initial code generation inexpensive, but every application still
repeats difficult cross-cutting work: identity, users, authorization,
notifications, audit, security, and external review access. Existing frameworks
reduce repetition by imposing a stack, architecture, permission model, and UI.
Once deeply customized, their generated or scaffolded code is difficult to
upgrade.

## Product Thesis

AIBA should make this workflow reliable:

1. Inspect an existing project.
2. Select a versioned capability.
3. Let the active AI agent adapt the implementation to that project.
4. Verify behavior against deterministic capability contracts.
5. Record where the implementation came from and what changed.
6. Upgrade the capability without overwriting project-owned customization.

## Defensible Core

AIBA's defensible core is:

- Capability contracts: stable semantics and invariants.
- Security conformance corpus: deterministic tests for high-risk behavior.
- Provenance: versioned receipts, evidence, hashes, and change history.
- Customization-aware upgrades: migrations that preserve project ownership.

AI is the adaptation engine. AIBA is the system of record and the judge.

## Product Shape

AIBA Core is an independent CLI and library. It must run in local development
and CI without an AI model. Codex, Claude Code, and future Agent skills are thin
adapters that teach an agent how to call AIBA, interpret capability packs, edit
the project, and respond to verification failures.

The first release is headless. It does not require a desktop UI, hosted control
plane, database, or model-provider account.

## Initial Wedge

The first capability is `review-access`: a temporary, least-privilege reviewer
identity for application-store and external reviewers. The WeChat-specific flow
is an adapter over a generic review-access contract.

The capability must ensure that reviewer access is server-authorized, scoped,
time-bound, revocable, rate-limited, audited, and isolated from sensitive
production data.

## Non-Goals For M0

- Supporting every programming language or framework.
- Building a complete user-management or admin product.
- Hosting identity, data, or secrets.
- Providing a visual capability marketplace.
- Generating application code without deterministic verification.
