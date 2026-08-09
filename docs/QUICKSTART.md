# AIBA Quick Start

**English** | [中文](QUICKSTART.zh-CN.md)

This path verifies the installed CLI, creates a clean project, authors an
Application Blueprint, and hands its bounded task graph to an AI Agent.
The CLI-side commands take only a few minutes; the agent-side implementation
time depends on your project and stack. On a first pass, follow only steps 1
to 5. The sections in the Appendix are optional.

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- Codex, Claude Code, or another Agent able to read the generated plan

## 1. Install AIBA

```bash
npm install --global @grubbylee/aiba
aiba --version
aiba agent-protocol --json
```

## 2. Create A Clean Project

Run these commands in a new directory, not inside the AIBA repository:

```bash
mkdir aiba-quickstart
cd aiba-quickstart
npm init -y
aiba init .
aiba inspect .
aiba doctor --root .
```

`doctor` should report that the project is initialized and ready.

## 3. Describe The Application

```bash
aiba create app work-hub
aiba plan applications/work-hub/app.yaml
aiba plan applications/work-hub/app.yaml --json
```

Edit `applications/work-hub/app.yaml` before planning. Replace the scaffold with
your resources, fields, states, operations, authorization actions, events, UI
intent, acceptance evidence, and allowed Agent write scopes. The names are
project data, not AIBA product models. Planning validates the document, resolves
exact capability dependencies, and prints a non-executable Agent task graph.
Add `--out .aiba/plans/work-hub.plan.json` if you want to keep the plan.

## 4. Hand The Plan To Your Agent

Ask the Agent to run `aiba agent-protocol --json`, read the Blueprint and JSON
plan, implement tasks in dependency order, stay inside each task's write scopes,
and preserve all listed invariants. AIBA does not execute the tasks or write the
application implementation.

For each planned reusable capability, use the normal verified lifecycle:

```bash
aiba add <capability> --root . --json
# Agent implements the bounded plan and records truthful evidence.
aiba add <capability> --root . --finalize --agent codex --json
```

Use `--agent claude-code` or another stable Agent identifier when appropriate.
Do not copy project-specific resources into an official capability or Solution.

## 5. Verify The Result

After all constituents are finalized:

```bash
aiba doctor --root .
aiba verify --root .
aiba inspect --root .
```

For runtime claims, use the separate signed `test`, `attest`, and
`verify-behavior` flow. AIBA Core never executes the test command itself.

To install the maintained `secure-workspace` composition instead of authoring a
Blueprint, use `aiba add secure-workspace --solution --root .`, then advance one
constituent at a time with `aiba continue secure-workspace --root .`.

## Appendix A: Standalone CLI Check

This path needs no Agent and verifies authoring from the npm package:

```bash
mkdir local-capabilities
aiba create capability appointment-booking --out ./local-capabilities
aiba lint ./local-capabilities/appointment-booking
aiba test-pack ./local-capabilities/appointment-booking
```

Enable completion for the current shell with one of:

```bash
source <(aiba completion bash)
source <(aiba completion zsh)
aiba completion fish | source
```

Use `--json` on every stable workflow command when integrating an Agent or CI.
Failures return one `AibaErrorEnvelope` on stderr and a nonzero exit code.

## Appendix B: Blueprint Revisions

Use these only after the first plan works:

```bash
aiba app-diff old.yaml new.yaml
aiba app-upgrade old.yaml new.yaml --plan <plan.json> --accept
```
