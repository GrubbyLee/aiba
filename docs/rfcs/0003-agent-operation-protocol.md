# RFC 0003: Agent Operation Protocol

Status: Accepted

## Purpose

Define a provider-independent protocol that lets Codex, Claude Code, and future
agents install a capability without moving contracts or correctness decisions
into a Skill.

## Lifecycle

```text
aiba inspect --json
        |
aiba add <capability> --json
        |
Agent applies project-specific edits
        |
aiba verify <capability> --json
        |
aiba add <capability> --finalize --json
        |
Receipt and lock state committed with project code
```

`prepare` must produce a bounded operation plan containing capability version,
required interfaces, invariants, recipe options, expected evidence, and allowed
project paths. It must not claim that an implementation exists.

`finalize` must only record evidence after verification inputs exist. It computes
hashes itself; an Agent cannot provide trusted hashes.

Calling `aiba add <capability>` without a lifecycle flag means `--prepare`.
Preparation writes `.aiba/plans/<capability>.yaml`. An Agent may populate only
the evidence `items` arrays. Capability identity, source hashes, recipe,
operations, evidence policy, and write scope are immutable inputs checked again
at finalization.

## Recipe Contract

A recipe is semantic guidance, not an executable generator. It declares stack
compatibility, bounded path patterns, intended operations, contract members,
and evidence suggestions. Recipes cannot declare shell commands, package
scripts, or success conditions. Core treats every pack as untrusted data and
never executes pack-provided code.

Recipe compatibility requires every declared language and framework to be
present in project inspection. An empty list imposes no restriction. If more
than one recipe matches, the caller must select one explicitly.

## Finalization Rules

Finalization reloads the capability and recipe and compares their SHA-256 hashes
with the prepared plan. It rejects modified contract fields, out-of-scope or
escaping evidence paths, missing evidence types, insufficient evidence, and
stale source files. Core computes all evidence hashes and writes the receipt,
manifest, and lock state as one recoverable operation, then runs normal
verification before reporting success.

The finalized receipt records the recipe, plan path, and plan hash. This makes
the Agent-authored evidence mapping part of installation provenance without
treating the Agent as a trust root.

## Service Boundary

Skills depend on the Agent Operation Protocol, not on a particular transport.
The first transport is the local CLI. A future local daemon or hosted AIBA
service may expose the same operations, authentication, and structured results.

Hosted operation must be opt-in. Project source and evidence stay local unless
an explicit team policy authorizes transmission.

## Deferred Decisions

- Whether `aiba add` should auto-detect and launch an installed Agent when run
  directly by a human. M1 adapters invoke the CLI explicitly.
- How later recipes express AST-aware edit hints. M1 recipes contain only
  semantic operations and human-readable guidance.
- Hosted transport authentication and policy. The local CLI remains the first
  protocol transport.
