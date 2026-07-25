# RFC 0003: Agent Operation Protocol

Status: Draft

## Purpose

Define a provider-independent protocol that lets Codex, Claude Code, and future
agents install a capability without moving contracts or correctness decisions
into a Skill.

## Proposed Lifecycle

```text
aiba inspect --json
        |
aiba add <capability> --prepare --json
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

## Service Boundary

Skills depend on the Agent Operation Protocol, not on a particular transport.
The first transport is the local CLI. A future local daemon or hosted AIBA
service may expose the same operations, authentication, and structured results.

Hosted operation must be opt-in. Project source and evidence stay local unless
an explicit team policy authorizes transmission.

## Open Decisions

- Whether `aiba add` should auto-detect and launch an installed Agent when run
  directly by a human.
- How recipes declare semantic edit operations without becoming fixed templates.
- Which verification checks must pass before `finalize` can write a receipt.
