# Implementation Tasks

Last updated: 2026-07-26

## Completed Milestone: M0

- [x] Decide that AIBA Core is independent software.
- [x] Define Agent skills as thin adapters and distribution channels.
- [x] Select TypeScript and a language-neutral protocol boundary.
- [x] Select `review-access` as the first capability.
- [x] Record vision, architecture, licensing intent, and roadmap.
- [x] Create workspace and build configuration.
- [x] Add public protocol schemas and TypeScript bindings.
- [x] Add capability and project-state loaders.
- [x] Add project initialization and inspection.
- [x] Add provenance evidence verification.
- [x] Add the `aiba init` command.
- [x] Add the `aiba inspect` command.
- [x] Add the `aiba verify` command.
- [x] Add the `review-access` capability pack.
- [x] Add a passing and failing reference fixture.
- [x] Add Node 22/24 CI checks.
- [x] Run build, typecheck, unit tests, and CLI smoke tests.

## Exit Criteria

M0 is complete when a clean checkout can install dependencies, build AIBA,
inspect a fixture, verify a correct `review-access` receipt, reject a broken
receipt with a non-zero exit code, and reproduce those checks in CI.

Exit criteria met on 2026-07-26.

## Completed Milestone: M1

- [x] Finalize RFC 0003 Agent Operation Protocol.
- [x] Define capability recipe and operation-plan schemas.
- [x] Implement `aiba add review-access` prepare/finalize lifecycle.
- [x] Implement automatic receipt hashing after verified installation.
- [x] Add the Codex Skill adapter.
- [x] Add the Claude Code Skill adapter.
- [x] Add a native WeChat Mini Program fixture.
- [x] Add black-box review-access attack tests.

## M1 Exit Criteria

M1 is complete when an Agent can prepare a bounded plan, adapt project-owned
code, submit evidence paths without trusted hashes, finalize an installation,
and pass deterministic verification. The same workflow must run through a
portable Codex/Claude Code Skill and against a native WeChat Mini Program with
HTTP and client-boundary attack tests.

Exit criteria met on 2026-07-26.

## Completed Milestone: M2

- [x] Define generated ancestry and semantic ownership records.
- [x] Define migration operations and conflict classes.
- [x] Implement `aiba diff` for capability and project drift.
- [x] Implement `aiba upgrade` prepare/finalize lifecycle.
- [x] Add a v2 review-access pack and dynamic customized v1 fixtures.
- [x] Add clean, customized, missing, project-owned, and conflicting upgrade tests.
- [x] Reject changed target sources and immutable migration-plan fields.
- [x] Verify recoverable replacement of manifest, lock, receipt, and ancestry.

## M2 Exit Criteria

M2 is complete when a compiled CLI can install v1, classify file drift, prepare
a v2 migration, require truthful conflict resolutions, finalize new provenance,
and verify the upgraded capability without overwriting project business files.
Source tampering and failed final verification must leave prior state intact.

Exit criteria met on 2026-07-26.

## Completed Milestone: M3

- [x] Define principal, authorization-decision, audit-event, and notification interfaces.
- [x] Implement the `identity` capability contract and reference recipe.
- [x] Implement the `users` lifecycle capability contract and reference recipe.
- [x] Implement the `authorization` capability contract and reference recipe.
- [x] Implement the `audit` capability contract and reference recipe.
- [x] Implement the `notification` capability contract and reference recipe.
- [x] Add dependency, composition, and cross-capability security tests.
- [x] Install all five capabilities into one provenance-verified fixture.

## M3 Exit Criteria

M3 is complete when the five capability contracts remain framework-neutral,
their portable interfaces validate deterministically, each reference boundary
passes positive and adversarial tests, required dependency order is enforced,
and one authenticated principal can traverse authorization, users,
notification, and audit without tenant or secret leakage. The compiled CLI must
verify all five receipts and report no drift.

Exit criteria met on 2026-07-26.

## Current Milestone: M4

- [ ] Define signed capability bundle and registry index protocols.
- [ ] Verify bundle integrity, publisher identity, and anti-rollback metadata.
- [ ] Add local and private registry resolution without executing packages.
- [ ] Define team policy, approval, and upgrade-governance records.
- [ ] Add commercial-boundary architecture for private registries and hosted controls.

## Known Risks

- Evidence hashes prove file identity, while capability-specific black-box tests
  prove selected behavior. Future packs need comparable conformance suites.
- Capability package code is untrusted input. Core does not execute
  pack-provided commands.
- Multi-version registries and signed packages are deferred until the local
  protocol stabilizes.
