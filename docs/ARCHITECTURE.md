# Architecture

## System Boundary

```text
Codex Skill ---------+
Claude Code Skill ---+--> AIBA CLI/Core --> Capability Packs --> Project
Other Agent Adapter -+          |
                                +--> Inspect / Verify / Record / Upgrade
                                           |
                                           +--> CI
```

AIBA is agent-native but agent-independent. The core does not depend on a model
provider SDK. Agent adapters may use the current host agent to generate patches,
but correctness is decided by deterministic AIBA commands.

## Layers

### Protocol

Language-neutral JSON Schemas define capability packs, project manifests, and
installation receipts. YAML is the human-authored representation. JSON Schema
is the public source of truth; TypeScript types are convenience bindings.

### Core

The core loads and validates manifests, inspects projects, resolves capability
packs, validates evidence, computes hashes, and produces structured diagnostic
results.

### CLI

The `aiba` binary is the stable human and automation interface. Commands must
support human-readable output, `--json`, non-interactive execution, and reliable
exit codes.

### Capability Packs

A capability pack contains stable semantics and verification requirements, not
a fixed UI implementation. A pack may later include stack-specific recipes,
migrations, fixtures, and Agent guidance.

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
  receipts/
    review-access.yaml
```

Receipts map capability invariants to implementation evidence. Evidence paths
must remain inside the project root and may carry SHA-256 hashes. Future upgrade
operations will use receipts plus Git history to distinguish generated ancestry
from project-owned customization.

## Technology Decisions

- Node.js 22+ and TypeScript for the initial implementation.
- pnpm workspaces for the monorepo.
- JSON Schema 2020-12 and Ajv for protocol validation.
- YAML for authored manifests and receipts.
- Vitest for unit and integration tests.
- Playwright for later UI conformance tests.
- TypeScript compiler APIs for the first semantic code adapter.
- Git diffs and hashes for provenance; no project-state database.

The protocol remains language-neutral. The first reference recipe uses a
TypeScript application stack, but capability semantics cannot mention Next.js,
React, Drizzle, or Better Auth.
