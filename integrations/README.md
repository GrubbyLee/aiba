# Agent Integrations

Agent integrations are thin adapters over AIBA Core. A Codex or Claude Code
Skill may connect through the local `aiba` CLI today and through a future AIBA
service API when team or hosted workflows require it.

Adapters may:

- Translate user intent into AIBA commands.
- Read structured project inspection and operation plans.
- Modify project-owned code with the host Agent.
- Re-run deterministic verification and repair failures.

Adapters may not:

- Redefine capability invariants.
- Mark verification as successful without Core results.
- Modify receipts after evidence changes without re-hashing.
- Send project files to a hosted service without explicit user policy.

## Portable Skill

`aiba-capabilities/` is the canonical Agent Skill for both Codex and Claude
Code. Install the same directory into the host's project or user skill location:

```text
.codex/skills/aiba-capabilities/    # Codex
.claude/skills/aiba-capabilities/   # Claude Code
```

Codex also reads `agents/openai.yaml` for UI metadata. Claude Code ignores that
optional file and follows the shared `SKILL.md`. Keeping one workflow prevents
provider adapters from redefining AIBA contracts differently.
