# RFC 0002: Review Access Capability

Status: Accepted for M0 implementation

## Purpose

`review-access` creates a constrained identity path for application-store or
external reviewers who cannot use the application's normal account onboarding.
It is not an authentication bypass and must never grant an internal user or
administrator identity.

## Required Semantics

- The reviewer is represented by a distinct principal type.
- Enablement is decided by trusted server-side state.
- Permissions and data scope follow least privilege.
- Access expires automatically and can be revoked immediately.
- Sensitive production data is isolated or sanitized.
- Attempts are rate-limited and resistant to guessing.
- Authentication and reviewer actions are audited.
- A client cannot self-assert reviewer identity or scope.

## Adapter Boundary

The generic contract does not mention WeChat, `openid`, or a Mini Program build.
A WeChat adapter may bind access to an approved Mini Program version, provide a
review-code flow, and expose sanitized review data while satisfying the same
invariants.

## Threats

- A production client discovers and enables a hidden local flag.
- A leaked shared reviewer credential remains valid indefinitely.
- Reviewer permissions inherit internal administrator roles.
- Review traffic reaches real customer or internal data.
- Attackers brute-force a review code.
- Review actions are indistinguishable from employee actions.
- A release accidentally leaves review access enabled.

## M0 Scope

M0 publishes invariants and verifies traceable evidence. Runtime attack tests,
signed remote switches, and a real WeChat adapter are M1 work.
