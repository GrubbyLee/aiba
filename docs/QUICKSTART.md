# AIBA Ten-Minute Quick Start

**English** | [中文](QUICKSTART.zh-CN.md)

This path verifies the installed CLI, creates a clean project, discovers a
Solution, and hands one bounded implementation step to an AI Agent. The setup
and handoff take about ten minutes. Implementing the full application depends on
the project and is intentionally not hidden behind that estimate.

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

## 3. Select A Verified Solution

```bash
aiba list
aiba show vehicle-management
aiba add vehicle-management --solution --root .
aiba status vehicle-management --root .
```

The last two commands prepare exactly one constituent capability and print its
plan path. AIBA has not executed pack code or claimed that application behavior
already exists.

## 4. Hand The Plan To Your Agent

Ask the Agent to read the generated `.aiba/plans/*.yaml`, implement only that
step in the current project, add the required evidence, and preserve every
invariant. Then run:

```bash
aiba continue vehicle-management --root . --finalize --agent codex
aiba continue vehicle-management --root .
```

Repeat the handoff and these two commands for each constituent. Use
`--agent claude-code` or another stable Agent identifier when appropriate.

## 5. Verify The Result

After all constituents are finalized:

```bash
aiba doctor --root .
aiba verify --root .
aiba compose vehicle-management --root .
```

For runtime claims, use the separate signed `test`, `attest`, and
`verify-behavior` flow. AIBA Core never executes the test command itself.

## Standalone CLI Check

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
