# RFC 0008: Team Governance And Signed Approvals

Status: Accepted for M4.3 implementation

## Purpose

Add deterministic team policy, cryptographic approvals, separation of duties,
and durable approval provenance to capability installation and upgrade without
making a hosted identity provider part of AIBA Core.

## Project Policy

An opted-in project stores `.aiba/governance-policy.json`. The policy defines:

- allowed capabilities and semantic-version ranges;
- trusted approver IDs, Ed25519 keys, and install/upgrade permissions;
- approval thresholds for install, upgrade, and conflict-bearing upgrade;
- maximum approval lifetime; and
- whether the recorded implementing Agent may approve its own operation.

The policy is project-owned, reviewed through Git, and treated as a mandatory
Core input whenever present. Removing policy is a visible repository governance
change; AIBA cannot defend against an attacker who can rewrite both repository
history and CI policy.

## Approval Statement

An approval signs a domain-separated RFC 8785 canonical statement binding the
project, operation type, capability versions, conflict count, exact plan path
and digest, a sorted SHA-256 list of every evidence file, exact policy path and
digest, approver key, creation time, and expiry. Approvals are created only after
implementation evidence and upgrade resolutions are final. Editing the plan,
evidence bytes, or policy invalidates prior approvals.

Each approver contributes at most one vote even when multiple keys exist.
Expired, future-dated, overlong, unauthorized, self-issued, malformed, or
cryptographically invalid approvals do not satisfy a threshold.

## Enforcement And Provenance

`add --finalize` and `upgrade --finalize` automatically enforce project policy.
The resulting capability receipt records the policy and accepted approval paths,
hashes, approver IDs, and key IDs. Later `aiba verify` checks those files remain
present and byte-identical to finalization time.

Approver private keys never enter project state. Agent adapters must not request
or handle them during normal implementation. Hosted SSO, organizational key
custody, and remote approval workflow are commercial/control-plane extensions
that cannot weaken local verification.
