# RFC 0019: Agent Adapter Protocol

Status: Implemented

## Decision

Agent adapters negotiate the installed AIBA CLI before acting:

```bash
aiba agent-protocol --json
```

The `AgentProtocolDescriptor` declares protocol and CLI versions, product
capabilities, advertised commands, mutation and resumability metadata, and the
response envelope contract. Protocol `0.1.0` requires `--json` for every Agent
call.

Successful output remains command-specific validated JSON. A failed Agent call
returns nonzero and writes an `AibaErrorEnvelope` to stderr with a stable
uppercase `error.code`, a human message, and optional protocol-validation
details. Agent behavior branches on the code, not the message text.

## Compatibility

Adding optional capabilities or commands does not break protocol `0.1.0`.
Removing a command, changing envelope shape, changing mutation semantics, or
making a formerly explicit action implicit requires a new protocol version.
CLI SemVer and Agent protocol SemVer are independent.

Codex, Claude Code, and other Skills remain thin adapters. They may choose how
to edit project-owned code, but they cannot redefine protocol invariants,
verification results, workflow state, governance, or trust policy.
