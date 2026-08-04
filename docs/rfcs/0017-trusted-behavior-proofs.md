# RFC 0017: Trusted Behavioral Proofs

Status: Implemented

## Problem

Evidence hashes prove that reviewed files are unchanged, but they do not prove
that runtime tests executed. Agent-written text must not be accepted as a test
result, and Core must not execute commands supplied by capability packs.

## Decision

AIBA separates test execution from proof verification:

1. `aiba test` verifies current evidence and creates a random, expiring
   challenge bound to the project snapshot, subject, exact command hash, test
   identity, and expected runner key.
2. A trusted CI or local runner executes that exact command outside AIBA and
   writes a bounded result summary inside the project.
3. `aiba attest` accepts only exit code zero during the challenge window and
   signs the challenge, timestamps, summary hash, and snapshot with Ed25519.
4. `aiba verify-behavior` independently verifies the signature, runner
   allowlist, revocation time, challenge bytes, command, summary, current
   evidence, provenance, and Solution composition.

The snapshot contains sorted hashes of `.aiba/manifest.yaml`, `.aiba/lock.json`,
the subject receipts, their declared evidence, plans, ancestry, policy, and
approvals. Behavior state cannot attest itself. The verifier first runs normal
evidence and provenance verification, so stale or malformed state fails closed.

## Security Boundary

AIBA records only the SHA-256 of the external command. It never executes the
command and never treats a pack recipe as executable input. A proof is valid
only while its challenge remains current and unexpired. Source, result, command,
trust, signature, key revocation, or subject-version changes require a new run.

This protocol proves that a trusted runner signed a successful execution claim
for exact bytes. It does not prove the runner itself is honest; runner key
custody and CI isolation remain operator responsibilities.
