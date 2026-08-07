# Implementation Tasks

Last updated: 2026-08-04

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
and pass deterministic evidence and provenance verification. The same workflow must run through a
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

## Completed Milestone: M4

- [x] Define signed capability bundle and publisher trust-policy protocols.
- [x] Add Ed25519 key generation and RFC 8785 manifest signing.
- [x] Verify exact file integrity, publisher identity, and capability allowlists.
- [x] Reject symlinks, scripts, binaries, extra files, traversal, and semantic drift.
- [x] Add compiled CLI smoke coverage for keygen, pack, verify, and tamper rejection.
- [x] Define signed registry index and anti-rollback protocols.
- [x] Verify registry signatures separately from capability publisher signatures.
- [x] Add immutable sequence snapshots, expiry, rollback, and equivocation checks.
- [x] Add local registry resolution without copying, installing, or executing packages.
- [x] Resolve the highest semantic version or an explicit exact version.
- [x] Add authenticated private registry transport and verified local caching.
- [x] Define project-owned team policy and signed approval records.
- [x] Bind approvals to plan, policy, versions, conflicts, and evidence-file hashes.
- [x] Enforce approval thresholds and optional separation of duties in finalization.
- [x] Record policy and approval hashes in receipts for later verification.
- [x] Add commercial-boundary architecture for private registries and hosted controls.

## M4.2 Exit Criteria

M4.2 is complete when an operator can create a new immutable signed index from
publisher-verified bundles, a client can resolve the newest or an exact version,
and persistent state rejects rollback and same-sequence equivocation. Expired,
future-dated, tampered, untrusted, mismatched, and symlinked inputs must fail
without advancing state. The compiled CLI must reproduce a sequence 1 to 2
upgrade and reject removal of sequence 2.

Exit criteria met on 2026-07-26.

## M4.3 Exit Criteria

M4.3 is complete when a governed project rejects unapproved installation and
upgrade, accepts only authorized Ed25519 approvals for the current policy, plan,
and evidence bytes, enforces distinct-approver thresholds and separation of
duties, and records accepted governance hashes in the final receipt. Wrong keys,
tampered signatures, expired approvals, changed policy, changed plan, and changed
evidence must fail. The compiled CLI must exercise policy initialization,
rejection, approval, checking, and separate install/upgrade finalization.

Exit criteria met on 2026-07-26.

## M4.4 Exit Criteria

M4.4 is complete when `aiba fetch` authenticates through an environment-provided
bearer token, verifies the signed registry index and bundle envelope before pack
download, fetches only signed size-bounded files, atomically publishes a fully
verified cache entry, and advances anti-rollback state only after cached
resolution succeeds. Missing credentials, redirects, oversized or interrupted
responses, tampered indexes, envelopes, and files, stale sequences, and cache
conflicts must fail closed without persisting secrets or false trusted state.
The AGPL Core and commercial hosted-control boundary must be explicit.

Exit criteria met on 2026-07-26.

## Completed Milestone: M5

- [x] Define the reference registry server and operator publication boundary.
- [x] Add verified, atomic, idempotent bundle import.
- [x] Add authenticated exact-path `GET` and `HEAD` distribution.
- [x] Add constant-time bearer authentication and environment-only secrets.
- [x] Add direct TLS and explicit localhost-only HTTP mode.
- [x] Verify the signed latest index and every indexed bundle before startup.
- [x] Reject traversal, encoded paths, queries, unsupported methods, and symlinks.
- [x] Add compiled CLI publish/serve/fetch smoke coverage.
- [x] Document the self-hosted workflow and operational limitations.

## M5 Exit Criteria

M5 is complete when an operator can import a publisher-verified bundle, create a
new signed immutable index, start a read-only authenticated registry, and fetch
the capability through the compiled CLI. Import conflicts, invalid registry
content, missing credentials, unsupported methods, queries, encoded traversal,
symlinks, and insecure non-local HTTP must fail closed. The server must expose no
mutation API, persist no token, and pass the full Node 22/24 CI matrix.

Exit criteria met on 2026-07-26.

## Milestone: M6 Release Readiness

- [x] Select the npm package topology and scope the CLI after npm rejected the
  unscoped `aiba` name.
- [x] Make all public package exports resolve only to shipped files.
- [x] Include official capability packs in the installed `@grubbylee/aiba` CLI.
- [x] Define lockstep package SemVer and independent protocol versioning.
- [x] License `aiba-spec` under Apache-2.0 for interoperability.
- [x] Add an explicit generated-output exception for application projects.
- [x] Build allowlisted release tarballs with ordinary SemVer dependencies.
- [x] Reject sources, tests, source maps, secrets, and workspace ranges in packs.
- [x] Install and exercise all tarballs in a clean external npm project.
- [x] Add resumable integrity-checked publishing with npm provenance.
- [x] Add annotated-tag release notes and protected GitHub environment guidance.
- [x] Publish npm v0.1.1 and create its GitHub Release after explicit approval.
- [x] Configure npm Trusted Publishing for all four packages before the next
  release.
- [x] Rebind and verify all four npm Trusted Publishers after renaming the
  GitHub repository from `ai-base` to `aiba`.
- [ ] Run an invited human beta in a real Mini Program project.
- [ ] Obtain qualified review of the exception and contributor agreement.

## M6 Exit Criteria

M6 release engineering is complete when a clean checkout produces four minimal
tarballs, installs them without workspace links, imports every public package,
uses the installed CLI and bundled capabilities, and reproduces the process in
CI. The first publication additionally requires explicit version, tag-push, and
GitHub Release approval plus npm publisher authentication.

## Known Risks

- Evidence hashes prove file identity, while capability-specific black-box tests
  prove selected behavior. Future packs need comparable conformance suites.
- Capability package code is untrusted input. Core does not execute
  pack-provided commands.
- Registry cache retention now has verified dry-run-first garbage collection;
  authenticated fetch, verified atomic caching, and anti-rollback state are
  complete.
- The first release used npm's interactive 2FA bootstrap path. Version 0.1.2
  exercised the documented GitHub OIDC Trusted Publishing path.
- The generated-output exception and future contributor agreement require
  qualified legal review before broad public launch.

## Milestone: M7 General Capability System

- [x] Define the five-layer catalog taxonomy and capability admission criteria.
- [x] Add optional `metadata.layer` protocol classification without invalidating
  existing third-party v0alpha1 manifests.
- [x] Classify all official packs without rewriting immutable legacy manifests.
- [x] Define portable file-asset command and record interfaces.
- [x] Add the `file-assets` capability contract and TypeScript recipe.
- [x] Implement and adversarially test the TypeScript file-assets boundary.
- [x] Include `file-assets` in fixture provenance, CLI distribution, Agent Skill,
  package verification, and smoke coverage.
- [x] Add the `import-export` business capability and its conformance corpus.
- [x] Validate a project-specific domain against portable capability interfaces,
  a reference boundary, and adversarial tests.
- [x] Add `wechat-miniprogram-auth` as the first platform integration with
  server-only code exchange, identity binding, replay defense, and secret-redaction tests.
- [x] Define a hash-bound solution-composition protocol and dependency graph rules.
- [x] Add a passing application composition fixture and read-only CLI check.
- [x] Add standalone publisher signatures and trust policy before enabling
  third-party, private Registry, mirror, or marketplace Solution distribution.
  npm provenance remains sufficient for the current official-only channel.
- [x] Validate capability semantics across TypeScript and native WeChat Mini
  Program boundaries.

## M7 Exit Criteria

M7 is complete when the catalog spans the first four capability layers with
independently verified packs, an authenticated official application Solution
composes those packs without weakening their invariants, and the same capability
semantics have been adapted to three materially different application surfaces. Every completed
pack must retain deterministic evidence/provenance verification, untrusted-pack safety,
and customization-aware upgrade behavior.

## Milestone: M8 Beta Adoption

- [x] Implement verified capability and Solution discovery in Core.
- [x] Add short `aiba list` and `aiba show <id>` commands with JSON output.
- [x] Reject Catalog/Manifest layer or version conflicts and invalid Solution graphs.
- [x] Exercise discovery from source smoke tests and installed npm tarballs.
- [x] Add a guided Solution installation workflow without hiding constituent plans.
- [x] Verify installed constituents before advancing and reject version or evidence drift.
- [x] Exercise one-step Solution progress in Core attack tests, CLI smoke, and npm tarballs.
- [x] Record guided installation state and security boundaries in RFC 0015.
- [x] Scope current verification to evidence and provenance in RFC 0016.
- [x] Define and implement separately named trusted behavioral test proofs.
- [ ] Run an invited human beta in a real Mini Program repository.
- [ ] Capture reproducible beta metrics and prioritize failure patterns.

## M8 Exit Criteria

M8 is complete when a developer unfamiliar with the repository can discover a
Solution, understand its requirements, install it through an Agent, pass local
verification, and report structured beta results without maintainer intervention.

## Active Development: M9-M15

The detailed acceptance criteria are tracked in `docs/ROADMAP.md`. Work proceeds
in dependency order: trusted behavioral proofs, resumable orchestration, Agent
protocol, authoring SDK, signed Solutions, Registry operations, and developer
experience. A checkbox is completed only when protocol schemas, implementation,
negative tests, packaged distribution, and user documentation agree.

### Completed: M9 Trusted Behavioral Proofs

- [x] Bind challenges to verified capability or Solution snapshots.
- [x] Sign successful external results with trusted Ed25519 runner keys.
- [x] Verify command, summary, time window, trust, revocation, signature, and
  current evidence without executing the command in Core.
- [x] Ship `test`, `attest`, and `verify-behavior` in the npm CLI.

### Completed: M10 Resumable Agent Orchestration

- [x] Derive workflow state from verified Project, Lock, receipts, Solution, and
  pending plan documents instead of a second mutable state database.
- [x] Add read-only `status`, one-step `continue`, and project `doctor` commands.
- [x] Reject stale plans, drifted constituents, and exact-version mismatches.
- [x] Preserve old `add --solution` compatibility and explicit finalization.

### Completed: M11 Agent Adapter Protocol

- [x] Publish `AgentProtocolDescriptor` and `AibaErrorEnvelope` JSON Schemas.
- [x] Add `agent-protocol --json` negotiation with command mutation metadata.
- [x] Return stable error codes on stderr for failed JSON commands.
- [x] Align the portable Codex/Claude Skill with workflow and behavior proofs.

### Completed: M12 Capability Authoring SDK

- [x] Scaffold framework-neutral capability contracts and exact Solutions.
- [x] Add authoring lint and static `test-pack` security-readiness reports.
- [x] Require invariant operation coverage, test guidance, and critical rules.
- [x] Reject overwrite, traversal, symlinks, scripts, special files, and bad
  dependency order without executing authored content.

### Completed: M13 Signed Solution Distribution

- [x] Add an independent Ed25519 signing domain for exact Solutions.
- [x] Bind publisher, key, sequence, validity window, identity, and file hash.
- [x] Enforce allowlists, timestamped key revocation, rollback, and equivocation.
- [x] Advance persistent state only after every trust and content check passes.

### Completed: M14 Production Registry Operations

- [x] Authenticate health, readiness, and Prometheus metrics endpoints.
- [x] Rate-limit requests and emit redacted operational audit events.
- [x] Verify deterministic backups before atomic restore into a new target.
- [x] Preserve retained index closure with dry-run-first garbage collection.
- [x] Ship and validate a hardened Docker image and Compose deployment example.

### Completed: M15 Beta-Ready Developer Experience

- [x] Publish bilingual ten-minute setup, Agent handoff, and standalone CLI paths.
- [x] Generate Bash, Zsh, and Fish completion from the registered CLI surface.
- [x] Return stable JSON envelopes for runtime and command-usage failures.
- [x] Exercise diagnostics, orchestration, authoring, completion, and failures
  from clean npm tarball installations.
- [x] Validate workflows and add macOS and Windows portability jobs alongside
  the Linux Node.js 22 and 24 matrix.

## Completed: M16-M18 Agent-Native Low Code

### M16 Common Application Protocol

- [x] Add bounded filters, stable sorting, opaque cursors, and page metadata.
- [x] Add reusable idempotency and optimistic-revision semantics.
- [x] Validate every shared interface and reject unknown or caller-owned scope fields.

### M17 Reusable Application Operations

- [x] Add `verification-challenge` contract, recipe, reference boundary, and attack tests.
- [x] Add `scheduled-jobs` contract, recipe, reference boundary, and attack tests.
- [x] Add `webhooks` contract, recipe, reference boundary, and attack tests.
- [x] Add `feature-flags` contract, recipe, reference boundary, and attack tests.
- [x] Add `organization` contract, recipe, reference boundary, and attack tests.
- [x] Add `comments-activity` contract, recipe, reference boundary, and attack tests.
- [x] Add `search` contract, recipe, reference boundary, and attack tests.

### M18 Business Workflow Foundation

- [x] Add `reporting` contract, recipe, reference boundary, and attack tests.
- [x] Add `workflow-approval` contract, recipe, reference boundary, and attack tests.
- [x] Upgrade `notification` semantics and preserve upgrade provenance.
- [x] Update Catalog, Agent Skill, fixture receipts, package checks, and smoke.
- [x] Update bilingual capability-model and catalog documentation.
- [x] Pass `pnpm check` locally.
- [x] Confirm the full remote portability matrix after push.

## Completed: M19 Composition-Ready Application Primitives

- [x] Add `i18n` schemas, recipe, secure reference boundary, and attack tests.
- [x] Add `data-dict` schemas, recipe, secure reference boundary, and attack tests.
- [x] Add `form-engine` schemas, recipe, secure reference boundary, and attack tests.
- [x] Add `inbox` schemas, recipe, secure reference boundary, and attack tests.
- [x] Add `tags` schemas, recipe, secure reference boundary, and attack tests.
- [x] Regenerate the reference fixture with exact M19 evidence and provenance.
- [x] Exercise all M19 packs through source smoke and clean npm tarballs.
- [x] Finish bilingual documentation and pass the complete local check.
- [x] Confirm Linux Node 22/24, macOS, Windows, Pages, and Gitee sync after push.
