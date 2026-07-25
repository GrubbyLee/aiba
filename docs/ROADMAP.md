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
- [ ] Add Codex and Claude Code skill adapters.
- [ ] Create a native WeChat Mini Program reference adapter.
- [ ] Add black-box HTTP and Playwright conformance tests.

## M2: Customization-Aware Upgrade

Goal: upgrade a deeply customized capability from v1 to v2 safely.

- [ ] Record generated ancestry and semantic ownership.
- [ ] Define migration operations and conflict classes.
- [ ] Implement `aiba diff` and `aiba upgrade`.
- [ ] Demonstrate v1-to-v2 review-access migration on two fixtures.

## M3: Core Capability Set

- [ ] Identity contract and adapters.
- [ ] Users lifecycle contract.
- [ ] Authorization contract and adapters.
- [ ] Audit contract and adapters.
- [ ] Notification contract.

## M4: Ecosystem And Commercial Layer

- [ ] Signed capability packages and registry protocol.
- [ ] Private capability registries.
- [ ] Team policy, approvals, and upgrade governance.
- [ ] Hosted signed review switches and enterprise integrations.
