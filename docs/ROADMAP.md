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

- [x] Signed capability bundles, publisher keys, and local trust policy.
- [x] Signed registry indexes, local resolution, expiry, and anti-rollback state.
- [x] Authenticated private registry transport and verified local caching.
- [x] Team policy, signed approvals, separation of duties, and upgrade governance.
- [x] Define the open Core and commercial hosted-control boundary.
- [ ] Build hosted key custody, signed review workflows, and enterprise integrations.

## M5: Self-Hosted Registry MVP

- [x] Add verified, atomic bundle import for registry operators.
- [x] Add an authenticated read-only v0 reference server.
- [x] Support direct TLS and explicit localhost HTTP development mode.
- [x] Validate the full registry before accepting traffic.
- [x] Exercise publish, serve, fetch, rollback, and attack paths end to end.
- [x] Document self-hosting and first-release operation.

## M6: Installable Distribution

- [x] Define the four-package npm topology and lockstep SemVer policy.
- [x] Package official capabilities with the installed CLI.
- [x] Define protocol compatibility and deprecation policy.
- [x] Add the generated-output exception and Apache-2.0 protocol boundary.
- [x] Build deterministic tarballs and a clean external-consumer trial.
- [x] Add a protected tag-driven npm provenance and GitHub Release workflow.
- [ ] Publish and install the first private beta after explicit release approval.
- [ ] Complete qualified legal review before broad public launch.
