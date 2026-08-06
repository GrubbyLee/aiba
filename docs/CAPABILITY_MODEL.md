# AIBA Capability Model

[English](CAPABILITY_MODEL.md) | [中文](CAPABILITY_MODEL.zh-CN.md)

## What AIBA Is

AIBA is agent-native low-code infrastructure. It is not an admin template,
visual page builder, fixed full-stack framework, or prompt library. AIBA gives
an AI Agent stable, versioned definitions of application behavior; the Agent
adapts that behavior to the project's existing stack and design; deterministic
Core commands inspect, verify, trace, and upgrade the result.

This separates what an application must guarantee from how its code and UI are
implemented. Generated code remains project-owned.

## The Three Building Blocks

1. **Common protocols** define bounded, language-neutral data semantics such as
   resource queries, opaque pagination cursors, idempotency keys, and optimistic
   revisions. They prevent each capability from inventing incompatible rules.
2. **Capability packs** define one reusable behavior through interfaces,
   dependencies, invariants, evidence requirements, recipes, migrations, and
   adversarial test guidance. Packs are untrusted data; Core never executes
   commands supplied by a pack.
3. **Industry Solutions** pin an exact, dependency-ordered composition of
   capabilities. Every constituent remains independently verified, and a
   Solution cannot weaken an invariant or hide a failed capability.

## Five Layers

| Layer | Purpose | Current catalog |
| --- | --- | --- |
| Application foundation | Cross-project application boundaries | `identity`, `authorization`, `users`, `notification`, `verification-challenge`, `data-dict`, `file-assets`, `i18n`, `scheduled-jobs`, `feature-flags`, `organization`, `search`, `review-access` |
| Platform integration | Provider and external-system boundaries | `webhooks`, `wechat-miniprogram-auth` |
| Business capability | Reusable business behavior | `comments-activity`, `import-export`, `reporting`, `workflow-approval`, `vehicle-records` |
| Engineering governance | Operational, security, and risk controls | `audit` |
| Industry solution | Exact compositions for a product domain | `vehicle-management` |

Catalog placement supports discovery; it is not verification authority. The
first four layers contain independently installable packs. The fifth contains
compositions.

## Capability Contract

An official capability has a stable ID and semantic version and declares:

- portable interfaces and required capability dependencies;
- testable invariants, severity, and acceptable evidence;
- a framework-neutral implementation recipe and security test plan;
- strict JSON Schemas and TypeScript bindings for public data;
- executable reference behavior and positive and adversarial tests;
- migrations when an upgrade changes project adaptation work.

A feature is a good capability candidate when it recurs across unrelated
applications, crosses a trust or data boundary, has deterministic acceptance
rules, benefits from provenance, or needs a meaningful upgrade path. Themes,
widgets, and one-off pages remain project code.

## Agent Workflow

```bash
aiba init
aiba list
aiba show reporting
aiba add reporting
# The Agent implements the bounded plan and adds evidence.
aiba add reporting --finalize --agent codex
aiba inspect
aiba verify
```

`add` prepares a plan; it does not silently generate or execute pack code. The
Agent maps the contract to the project's framework, storage, providers, and UI.
Finalization hashes project evidence and records provenance only after Core
verification. `diff` and `upgrade` compare recorded ancestry with current code
so project customization is not treated as disposable generated output.

For a composition, use `aiba add vehicle-management --solution`, then
`aiba status vehicle-management` and `aiba continue vehicle-management`. AIBA
advances one capability at a time in dependency order.

## Selection And Composition

Start with the business outcome, use `aiba show <id>` to inspect dependencies
and invariants, and install the smallest sufficient set. Shared behavior should
depend on common protocols or foundation capabilities rather than duplicating
them. Provider-specific details stay in platform integrations. Product-specific
rules stay in project code until they meet the catalog admission criteria.

Use a Solution only when the exact combination itself has durable domain
meaning. A large bundle of unrelated features is not a Solution.

## Trust And Verification

AIBA deliberately separates several claims:

- Schema and graph validation prove that contracts and dependencies are valid.
- Evidence and provenance verification prove that declared project files,
  hashes, receipts, ancestry, and approvals are intact.
- Trusted behavior proofs bind externally run tests to an exact source snapshot;
  Core does not run the test command.
- Publisher and Registry signatures prove artifact identity and integrity, not
  runtime correctness.

Caller-controlled tenant scope, credentials, provider destinations, raw query
languages, executable pack content, and unverifiable success claims are rejected
at their respective boundaries. The offline AGPL Core remains the final local
verifier regardless of Agent or distribution channel.

## Extending The Catalog

Create and validate a candidate without changing Core semantics:

```bash
aiba create capability appointment-booking
aiba lint capabilities/appointment-booking
aiba test-pack capabilities/appointment-booking
```

New official packs should add schemas, bindings, a framework-neutral recipe,
reference behavior, attack tests, migration guidance where needed, and catalog
dependency-order coverage. See [Authoring](AUTHORING.md) and
[RFC 0012](rfcs/0012-capability-taxonomy.md).
