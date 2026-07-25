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

The initial Codex and Claude Code adapters are planned in M1 after the Agent
Operation Protocol is accepted.
