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

## Current Milestone: M1

- [x] Finalize RFC 0003 Agent Operation Protocol.
- [x] Define capability recipe and operation-plan schemas.
- [x] Implement `aiba add review-access` prepare/finalize lifecycle.
- [x] Implement automatic receipt hashing after verified installation.
- [ ] Add the Codex Skill adapter.
- [ ] Add the Claude Code Skill adapter.
- [ ] Add a native WeChat Mini Program fixture.
- [ ] Add black-box review-access attack tests.

## Known Risks

- Evidence hashes prove file identity, not behavior. M1 must add executable
  black-box conformance tests.
- Capability package code is untrusted input. M0 does not execute pack-provided
  commands.
- Multi-version registries and signed packages are deferred until the local
  protocol stabilizes.
