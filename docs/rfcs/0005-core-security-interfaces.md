# RFC 0005: Core Security Interfaces

Status: Implemented

## Purpose

Define a small language-neutral vocabulary that lets identity, users,
authorization, audit, notification, and review-access capabilities compose
without forcing projects to share a framework, database, or wire protocol.

## Principal

A principal identifies an authenticated subject. Its stable fields are
`type`, `subject`, and an optional tenant boundary. It deliberately contains no
roles, permissions, scopes, or client-provided claims. Those values belong to
trusted policy inputs and authorization decisions.

Allowed principal types are `user`, `service`, `reviewer`, and `anonymous`.
Adapters may use richer project-local models, but evidence must prove that the
same subject and tenant semantics survive the mapping.

## Authorization Decision

An authorization decision binds one principal, action, and resource to an
explicit allow or deny result. It includes a reason code, policy version, and
evaluation time so callers and audit pipelines can attribute the result. A
missing, malformed, or failed decision is a denial; callers must not infer
permission from identity attributes.

## Audit Event

An audit event records an attributable security action and outcome with an
immutable event identifier, timestamp, actor, correlation identifier, and
optional target. Credentials, password hashes, session tokens, reset tokens,
and notification secrets are forbidden event content. Project adapters may add
storage metadata outside the portable event, but must preserve redaction and
append-only semantics.

## Compatibility

Canonical schemas live in `packages/spec/schema/interfaces/`. TypeScript types
are bindings, not the source of truth. Capability implementations do not need
to expose these exact objects on a public API; they may map established local
types to the same semantics and record source/test evidence for that mapping.

Interface schemas use `aiba.dev/interfaces/v0alpha1` independently from
capability versions. Breaking interface changes require a new schema version
and capability migration guidance.

## Security Boundaries

- Clients cannot choose principal type, subject, tenant, role, or permission.
- Authentication creates a principal; it never implies authorization.
- Authorization fails closed and emits a reason suitable for auditing.
- Audit events identify actions without containing reusable secrets.
- Capability packs describe these requirements as untrusted data; Core does
  not execute pack-provided operations or tests.
