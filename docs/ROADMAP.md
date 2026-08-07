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
- [x] Publish and install the first public npm release after explicit approval.
- [x] Configure npm Trusted Publishing for unattended provenance releases.
- [ ] Complete qualified legal review before broad public launch.

## M7: General Capability System

Goal: prove that AIBA delivers verifiable software capabilities beyond the
initial identity and security foundation.

- [x] Define the five-layer capability taxonomy and compatibility rules.
- [x] Add a backward-compatible capability-layer field to the public protocol.
- [x] Classify every official capability and validate catalog consistency.
- [x] Deliver `file-assets` as the first non-identity application capability.
- [x] Add secure reference behavior and adversarial conformance tests for files.
- [x] Deliver `import-export` as the first reusable business capability.
- [x] Validate project-specific domains against shared capability contracts.
- [x] Deliver `wechat-miniprogram-auth` as the first platform integration.
- [x] Define hash-bound solution composition without allowing invariant weakening.
- [x] Compose and verify an exact dependency-ordered application Solution.
- [x] Add standalone publisher signatures before enabling third-party or
  non-npm Solution distribution; this does not block the current official channel.
- [x] Validate selected capabilities in TypeScript API, web admin, and native
  WeChat Mini Program projects without imposing a shared UI framework.

M7 is complete when at least one capability from each of the first four layers
has passed the full install, verify, provenance, distribution, and upgrade
lifecycle, and one application Solution composes them without bypassing individual
verification.

## M8: Beta Adoption

Goal: let a developer discover, evaluate, install, and verify AIBA in a real
project without reading repository internals.

- [x] Add verified `aiba list` discovery across all capability layers and Solutions.
- [x] Add `aiba show` for exact dependencies, interfaces, invariants, and composition.
- [x] Add a guided Solution installation workflow that preserves per-capability plans.
- [ ] Run an invited human beta in a real Mini Program repository.
- [ ] Record setup time, verification failures, Agent corrections, and upgrade feedback.

M8 is complete when an invited developer can select a Solution from the CLI,
adapt it through an Agent, pass independent verification, and repeat the process
from documented steps without maintainer intervention.

## M9: Trusted Behavioral Proofs

Goal: bind an externally executed test result to the exact project, capability,
runner identity, challenge, and source snapshot without executing pack-provided
commands in Core.

- [x] Define challenge, signed proof, runner trust, and revocation protocols.
- [x] Add prepare, attest, and verify behavior-proof commands.
- [x] Reject replayed, expired, stale, unsigned, or untrusted proofs.

## M10: Resumable Agent Orchestration

- [x] Persist inspectable Solution workflow state without duplicating Core truth.
- [x] Add `status`, `continue`, and `doctor` commands with JSON output.
- [x] Preserve one-capability-per-step execution and safe interruption recovery.

## M11: Agent Adapter Protocol

- [x] Publish a machine-readable Agent capability and error envelope.
- [x] Add protocol negotiation and consistent Codex/Claude adapter guidance.
- [x] Test every advertised command and structured failure contract.

## M12: Capability Authoring SDK

- [x] Scaffold capabilities and Solutions from safe built-in templates.
- [x] Add authoring lint and test-pack quality gates.
- [x] Check identifiers, schemas, dependency closure, recipes, and security tests.

## M13: Signed Solution Distribution

- [x] Sign exact Solution files with Ed25519 publisher identities.
- [x] Enforce publisher allowlists, key revocation, expiry, and anti-rollback state.
- [x] Keep official npm provenance valid while enabling independent channels.

## M14: Production Registry Operations

- [x] Add authenticated health, readiness, and Prometheus metrics endpoints.
- [x] Add verified backup, restore, retention, and dry-run garbage collection.
- [x] Ship a hardened container image and deployment example.

## M15: Beta-Ready Developer Experience

- [x] Provide a ten-minute Quick Start and standalone example path.
- [x] Add stable errors, complete JSON output, shell completion, and diagnostics.
- [x] Validate Linux, macOS, and Windows behavior in CI where applicable.

M9-M15 are development-complete when all public protocols have schemas, all
commands ship in npm tarballs, adversarial tests pass in CI, and the documented
clean-project path is reproducible. Hosted multi-tenancy, billing, production
key custody, qualified legal review, and invited human beta remain external
launch gates rather than claims made by the open-source implementation.

## M16: Common Application Protocol

Goal: standardize repeated application semantics before they fragment across
capability packs.

- [x] Define bounded resource query, filter, sort, cursor, and page contracts.
- [x] Define reusable idempotency and optimistic revision fields for mutations.
- [x] Add strict JSON Schemas, TypeScript bindings, validators, and malformed-input tests.

## M17: Reusable Application Operations

Goal: cover operational capabilities repeatedly rebuilt in ordinary Agent-
generated applications without imposing a database, queue, provider, or UI.

- [x] Deliver `verification-challenge` for single-use email, SMS, and authenticator challenges.
- [x] Deliver `scheduled-jobs` with leases, bounded retries, and idempotent execution.
- [x] Deliver `webhooks` with trusted destinations, signatures, replay defense, and delivery state.
- [x] Deliver `feature-flags` with trusted targeting, deterministic rollout, and revisioned policy.
- [x] Deliver `organization` with tenant-derived membership and last-owner protection.
- [x] Deliver `comments-activity` with attributable, revisioned, soft-deleted discussion records.
- [x] Deliver `search` with bounded queries, authorization-first filtering, and opaque cursors.

## M18: Business Workflow Foundation

Goal: provide higher-level application behavior that composes the common
protocol and operational capabilities.

- [x] Deliver `reporting` with server-owned definitions, authorization, bounded execution,
  private outputs, and sensitive-field minimization.
- [x] Deliver `workflow-approval` with explicit state transitions, separation of duties,
  optimistic concurrency, and immutable decisions.
- [x] Upgrade `notification` with template versions, preferences, durable deduplication,
  delivery lifecycle, and minimized receipts.
- [x] Integrate every new pack into discovery, Agent guidance, reference fixtures,
  deterministic npm tarballs, and smoke tests.
- [x] Publish the expanded capability model and catalog in bilingual documentation.

M16-M18 are complete when every public interface is schema validated, each
capability has a framework-neutral recipe and executable positive and adversarial
reference tests, all packs are discoverable from the installed CLI, and `pnpm
check` plus the Linux/macOS/Windows CI matrix pass.

## M19: Composition-Ready Application Primitives

Goal: cover recurring product semantics that ordinary Agent-built applications
need beyond authentication and CRUD, while keeping rendering, storage, and
provider choices project-owned.

- [x] Deliver `i18n` with revisioned catalogs, trusted locale resolution,
  fallback, pluralization, and sanitized interpolation.
- [x] Deliver `data-dict` with typed tenant dictionaries, hierarchy, status,
  revision, and server-side value validation.
- [x] Deliver `form-engine` with portable definitions, exact schema revisions,
  trusted validation, dependency checks, file scoping, and idempotent submission.
- [x] Deliver `inbox` with trusted message creation, principal-scoped listing,
  signed cursors, unread counts, and revisioned state transitions.
- [x] Deliver `tags` with normalized tenant-unique names, safe archival, and
  authorized atomic resource assignments.
- [x] Integrate all five packs into fixture provenance, Agent guidance, source
  smoke, deterministic npm tarball checks, and bilingual documentation.
- [x] Pass the complete local check.
- [x] Confirm the remote portability workflows after push.

M19 is complete when all 24 official capabilities are dependency ordered and
discoverable, the 23-capability reference fixture verifies exact source and test
evidence, all five M19 packs score 100 in authoring checks, and the complete
local and hosted CI gates pass.

## M20: Domain-Neutral Application Blueprints

Goal: let a user describe a project-specific application while AIBA
deterministically resolves reusable capabilities and bounded Agent work without
turning any example business domain into product infrastructure.

- [x] Remove project-specific business models from official protocols, packs,
  Solutions, executable fixtures, and release artifacts.
- [x] Define strict Blueprint, Application Plan, and Blueprint Upgrade Plan
  protocols with language-neutral TypeScript bindings.
- [x] Compile resources, workflows, authorization intent, events, UI intent,
  evidence, and write scopes into an exact dependency and Agent task graph.
- [x] Expose `aiba create app <id>` and read-only `aiba plan <app.yaml>`.
- [x] Preserve compatible project-owned customization and require explicit
  decisions for breaking, security-sensitive, and conflicting upgrades.
- [x] Exercise a domain-neutral collaboration application and adversarial cases.
- [ ] Confirm the complete hosted portability and mirror workflows after push.

M20 is complete when all three schemas ship in `aiba-spec`, the installed CLI
can scaffold and plan a Blueprint, v1-to-v2 upgrades preserve project-owned
customization, unsafe intent is rejected, `pnpm check` passes, and hosted CI
confirms the same result. Business nouns remain project data at every boundary.
