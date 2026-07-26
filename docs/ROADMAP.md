# Roadmap

## M0: Contract And Verification

Goal: prove that AIBA can describe and deterministically verify one capability.

- [x] Record product vision and architecture decisions.
- [x] Establish TypeScript monorepo and quality gates.
- [x] Add Capability Contract v0 schemas.
- [x] Implement project initialization and inspection.
- [x] Implement receipt and evidence verification.
- [x] Add the `review-access` capability pack.
- [x] Validate passing and failing fixtures through the CLI.

## M1: Agent-Assisted Installation

Goal: let Codex and Claude Code install `review-access` into an existing
TypeScript project.

- [x] Define the Agent operation protocol.
- [x] Implement `aiba add review-access` preparation and finalization.
- [x] Add a portable Codex and Claude Code skill adapter.
- [x] Create a native WeChat Mini Program reference adapter.
- [x] Add black-box HTTP and native client contract tests.

## M2: Customization-Aware Upgrade

Goal: upgrade a deeply customized capability from v1 to v2 safely.

- [x] Record generated ancestry and semantic ownership.
- [x] Define migration operations and conflict classes.
- [x] Implement `aiba diff` and `aiba upgrade`.
- [x] Demonstrate v1-to-v2 review-access migration on clean and customized fixtures.

## M3: Core Capability Set

- [x] Identity contract and reference adapter.
- [x] Users lifecycle contract and reference adapter.
- [x] Authorization contract and reference adapter.
- [x] Audit contract and reference adapter.
- [x] Notification contract and reference adapter.
- [x] Shared security interface schemas and cross-capability attack tests.

## M4: Ecosystem And Commercial Layer

- [ ] Signed capability packages and registry protocol.
- [ ] Private capability registries.
- [ ] Team policy, approvals, and upgrade governance.
- [ ] Hosted signed review switches and enterprise integrations.
