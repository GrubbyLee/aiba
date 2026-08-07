# Architecture

## System Boundary

```text
Codex Skill ---------+
Claude Code Skill ---+--> Application Blueprint --> AIBA CLI/Core --> Project
Other Agent Adapter -+          |
                                +--> Capability Packs / Agent Task Plan
                                +--> Inspect / Verify / Record / Upgrade
                                           |
                                           +--> CI

Signed Publisher --> registry-add --> Signed Index --> Registry Server
                                                        |
                                                        +--> aiba fetch
```

AIBA, Agent Infrastructure for Building Applications, is agent-native but
agent-independent. The core does not depend on a model provider SDK. Agent
adapters may use the current host agent to generate patches, but evidence and
provenance validity is decided by deterministic AIBA commands.

## Layers

### Protocol

Language-neutral JSON Schemas define capability packs, project manifests,
installation receipts, and portable security interfaces. YAML is the
human-authored representation. JSON Schema is the public source of truth;
TypeScript types are convenience bindings.

M3 interface schemas define `Principal`, `AuthorizationDecision`, `AuditEvent`,
`NotificationCommand`, and `NotificationReceipt`. They are semantic mapping
targets rather than mandatory public API DTOs. In particular, principals do not
carry roles or permissions; policy produces a separate explicit decision.

M7 adds portable file-asset upload/record, import/export command/job, WeChat Mini
Program login, and capability-solution schemas.
These interfaces deliberately carry opaque identifiers and bounded metadata,
not provider URLs, storage keys, table names, queries, mappings, callbacks, raw
rows, or credentials. Trusted project adapters map them to local storage,
database, parser, and queue choices.

The first platform integration, `wechat-miniprogram-auth`, maps a one-time
`wx.login` code to an AIBA principal. Its portable client command contains only
the code and its portable result contains only a principal and issuance time.
AppSecret, provider endpoint configuration, OpenID/UnionID binding, and
`session_key` stay behind injected server interfaces.

A `CapabilitySolution` is an ordered, content-bound composition. Each entry
pins a capability ID, exact version, manifest SHA-256, and product purpose.
Core rejects duplicate entries, incomplete required dependency closure,
unsatisfied ranges, and dependencies placed after their consumers. The schema
has no command, override, optionality, or ignored-invariant field.

An `ApplicationBlueprint` is the project-owned, framework-neutral composition
contract. It describes resources, relationships, states, operations,
authorization intent, events, UI intent, acceptance evidence, and bounded Agent
write scopes. Business nouns are valid only inside the user's Blueprint; they
do not become official protocols or catalog entries. An `ApplicationPlan` binds
the exact Blueprint hash to dependency-ordered capabilities and non-executable
Agent tasks. Upgrade plans classify changes and preserve compatible
project-owned task customizations.

### Core

The core loads and validates Blueprints and manifests, inspects projects, resolves capability
packs, validates evidence, computes hashes, and produces structured diagnostic
results. Blueprint planning is deterministic and read-only; upgrade acceptance
requires explicit resolution of breaking, security-sensitive, and customization
conflicts. Core also creates and verifies signed bundle envelopes without
importing or executing pack content, Agent tasks, or application code.

### CLI

The `aiba` binary is the stable human and automation interface. Commands must
support human-readable output, `--json`, non-interactive execution, and reliable
exit codes.

`create app <id>` writes an editable Blueprint scaffold. `plan <app.yaml>`
validates and compiles it, prints the exact capability and task graph, and does
not mutate the host project. `plan --out <plan.json>` persists that exact
deterministic plan as a JSON artifact inside a safe project-local path.

`app-diff <old.yaml> <new.yaml>` compares two exact Blueprints and renders a
stable upgrade plan. `app-upgrade <old.yaml> <new.yaml>` can then load a
persisted plan, require explicit resolutions for non-additive changes, and
accept the upgrade only when the current source hashes still match.

`compose` is read-only. It first validates the solution graph, then runs the
ordinary project verifier separately for every exact constituent. It reports
the installation order and missing or drifted capabilities; it never installs
code or converts a failed constituent into a passing solution.

`add <solution> --solution` is the stateful guided path. One invocation prepares
or finalizes at most one constituent in the exact Solution order. Existing
constituents must pass ordinary evidence and provenance verification before Core advances. Every
constituent retains its own plan, governance decision, receipt, evidence hashes,
ancestry, and verification boundary; finalizing the last constituent triggers a
full `compose` evidence and provenance verification. Core never executes recipe content or creates all
constituent plans in a batch.

### Capability Packs

A capability pack contains stable semantics and verification requirements, not
a fixed UI implementation. A pack may later include stack-specific recipes,
migrations, fixtures, and Agent guidance.

An optional manifest `metadata.layer` and the version-bound
`CapabilityCatalog` organize packs into application foundations, platform
integrations, business capabilities, engineering governance, and industry
solutions. Classification is discovery metadata, never verification authority.
The separate catalog can classify an immutable legacy manifest without changing
its bytes; when a manifest embeds a layer, catalog identity, version, and layer
must agree.

Signed bundles authenticate an exact, size-bounded file set with Ed25519 and
RFC 8785 canonical JSON. Local trust policy authorizes an exact publisher/key
pair for an explicit capability allowlist. Bundle verification rejects
symlinks, executable payloads, extra files, traversal paths, source tampering,
and invalid recipe or migration semantics. A valid signature proves publisher
identity and byte integrity; it never turns pack data into executable code.

Local registries store immutable signed snapshots under `indexes/<sequence>`.
The index binds capability versions to exact bundle digests and publisher keys.
Registry-operator trust and capability-publisher trust remain separate. A local
state file records the highest accepted sequence and digest, rejecting both
older snapshots and same-sequence equivocation. State advances only after the
selected bundle verifies. Resolution returns paths and never installs or
executes pack content.

Private registry transport treats the network and cache as untrusted. `fetch`
reads bearer credentials only from an environment variable, requires HTTPS,
rejects redirects, and enforces request timeouts and streaming size limits. It
verifies the signed index before bundle selection, verifies the bundle envelope
before pack download, and fetches only signed paths at exact declared sizes.
Core publishes a cache entry atomically only after full local verification, then
reuses normal local resolution to advance anti-rollback state.

The hosted commercial layer provides operations: tenant isolation, SSO/SCIM,
key custody, publishing and approval workflow, audit retention, integrations,
SLA, and support. It is not a verification authority. The AGPL Core remains a
complete offline verifier, and hosted output must reduce to signed artifacts and
policies that Core can reject locally. See RFC 0009.

### Team Governance

Projects opt into governance with `.aiba/governance-policy.json`. Policy limits
capabilities and versions, authorizes Ed25519 approver keys, sets operation and
conflict thresholds, and can prohibit the recorded implementing Agent from
self-approval. Approval signatures bind the exact plan, policy, capability
versions, conflict count, and SHA-256 of every evidence file. Finalization fails
closed when policy exists, and capability receipts pin the accepted governance
files for later provenance verification.

Core can enforce only the Agent identity recorded by the local caller. Hosted
runner attestation, SSO identity, protected policy branches, and organizational
key custody remain control-plane concerns; they may strengthen but cannot bypass
local plan, evidence, signature, or threshold checks.

### Reference Registry Server

The server is a separate package over Core verification. Operators import
publisher-signed bundles through verified atomic staging, then explicitly sign a
new immutable index. At startup the server verifies that index and every listed
bundle and builds an exact read-only route allowlist. Bearer authentication,
constant-time token comparison, direct TLS, strict methods and paths, and
symlink rejection protect transport, while clients still independently verify
all artifacts. There is no remote mutation or signing endpoint.

### Agent Adapters

Skills are distribution and integration channels. They translate natural
language intent into AIBA operations and use the host Agent to adapt code. They
must not replace contracts, provenance, or conformance checks.

## Project State

Project-owned AIBA state is text and is committed to Git:

```text
.aiba/
  manifest.yaml
  lock.json
  ancestry/
    review-access.json
  plans/
    review-access.yaml
    review-access.upgrade.yaml
  receipts/
    review-access.yaml
  registry-state.json
  governance-policy.json
  approvals/
    review-access/
      install/
      upgrade/
```

Receipts map capability invariants to hashed implementation evidence. Evidence
paths must remain inside the project root. Ancestry records the installation
hash and semantic ownership of each evidence file, allowing `aiba diff` and
`aiba upgrade` to distinguish unchanged, customized, missing, and project-owned
code without storing source contents. State replacement is recoverable and is
accepted only after target verification succeeds.

`VerificationReport.scope` is currently always `evidence-and-provenance`.
Within that scope, `ok` proves structural validity, safe evidence paths, source
and evidence hashes, dependency closure, receipts, ancestry, and governance
bindings. It does not prove that project tests ran or that runtime behavior
satisfies an invariant. Behavioral conformance uses the separately named
`test`, `attest`, and `verify-behavior` proof protocol. An external trusted
runner executes the bound command; Core verifies its signed, source-bound proof
and never silently widens the meaning of `ok`.

Registry state is a mutable trust checkpoint rather than provenance evidence.
Keep it in persistent trusted project or CI storage and review sequence changes;
deleting it resets anti-rollback protection to first use.

The default `.aiba/registry-cache/` is derived local data, not project
provenance. Exclude it from Git and rebuild it only through `aiba fetch` or a
separately verified local registry. Do not delete trusted anti-rollback state
when clearing cached bundles.

Governance policy and approvals are committed review inputs. Approver private
keys remain outside the project. Policy removal or replacement is itself a
repository governance change that CI and branch protection must review.

## Technology Decisions

- Node.js 22+ and TypeScript for the initial implementation.
- pnpm workspaces for the monorepo.
- JSON Schema 2020-12 and Ajv for protocol validation.
- YAML for authored manifests and receipts.
- Vitest for unit and integration tests.
- Playwright for later UI conformance tests.
- TypeScript compiler APIs for the first semantic code adapter.
- Git diffs and hashes for provenance; no project-state database.
- Ed25519, RFC 8785 canonical JSON, and local publisher allowlists for signed
  capability distribution.
- Immutable registry snapshots with expiry and persistent sequence/digest state
  for rollback and equivocation detection.
- Authenticated HTTPS registry fetch with environment-only bearer tokens,
  redirect rejection, bounded streaming, and atomically published verified cache.
- Project-owned team policy and domain-separated Ed25519 approvals bound to plan,
  policy, versions, conflicts, and evidence hashes.
- Native Mini Program clients are validated with WeChat syntax checks and
  client-contract tests; server boundaries use black-box HTTP attack tests.
- Core security capability references use injected stores/provider adapters,
  standard Node cryptography, and cross-capability attack tests without a
  database or application-framework dependency.

The protocol remains language-neutral. The first reference recipe uses a
TypeScript application stack, but capability semantics cannot mention Next.js,
React, Drizzle, or Better Auth.
