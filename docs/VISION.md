# AIBA Vision

## Product Definition

AIBA means **Agent Infrastructure for Building Applications**. It is
application-building infrastructure for AI agents, not an admin template, a
fixed full-stack framework, or a prompt collection. Its independent capability
delivery system allows AI agents to install verifiable software capabilities
into existing projects while preserving project architecture, visual language,
and code ownership.

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
4. Verify evidence and provenance, then evaluate behavior with trusted conformance tests.
5. Record where the implementation came from and what changed.
6. Upgrade the capability without overwriting project-owned customization.

## Defensible Core

AIBA's defensible core is:

- Capability contracts: stable semantics and invariants.
- Security conformance corpus: deterministic tests for high-risk behavior.
- Provenance: versioned receipts, evidence, hashes, and change history.
- Customization-aware upgrades: migrations that preserve project ownership.

AI is the adaptation engine. AIBA is the system of record and the judge.

## Capability Portfolio

AIBA organizes its catalog into five layers. The layers describe stable
software semantics, not a required framework, database, provider, or UI:

1. `application-foundation`: reusable application boundaries such as identity,
   authorization, files, notifications, search, and background jobs.
2. `platform-integration`: provider-facing boundaries such as WeChat, payments,
   email, SMS, object storage, maps, and model APIs.
3. `business-capability`: reusable business behavior such as orders,
   subscriptions, approvals, import/export, content, and inventory.
4. `engineering-governance`: operational and risk controls such as audit,
   observability, rate limits, data retention, redaction, backup, and compliance.
5. `application-solution`: versioned, dependency-ordered capability
   compositions without built-in business entities.

The first four layers are independently verifiable capability packs. An
application solution composes those packs without redefining contracts and must
not weaken or bypass any constituent invariant.

A feature belongs in the AIBA catalog when it is repeatedly implemented across
projects, crosses meaningful system boundaries, has testable acceptance or
security rules, and needs provenance or upgrades. Atomic UI components and
one-off page layouts remain project-owned code.

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
- Claiming behavioral correctness from evidence hashes alone.
