# RFC 0010: Reference Registry Server

Status: Accepted for M5 implementation

## Purpose

Provide a self-hostable reference server for the v0 private registry protocol
and a controlled operator workflow for publishing signed capability bundles.
The server must remain a transport boundary, not a new verification authority.

## Operator Workflow

`aiba registry-add <bundle>` verifies the complete bundle against an explicit
publisher trust policy, copies it into registry-owned staging, verifies the copy,
and atomically publishes it at `bundles/<capability>/<version>`. Existing equal
content is idempotent; existing conflicting content fails closed. It never
creates signatures or handles publisher private keys.

The operator then runs the existing `aiba registry-index` command with the next
sequence and an expiry. Index signing remains an explicit separate action so an
uploaded bundle cannot silently mutate the client-visible catalog.

## Server Boundary

`aiba registry-serve <registry>` exposes only the RFC 0009 `GET` and `HEAD`
paths. It requires a read bearer token from a named environment variable,
compares credentials in constant time, rejects queries, encoded or traversal
paths, unsupported methods, symlinks, non-files, and all directory listings.
Responses use exact content lengths, conservative content types, `no-store`,
`nosniff`, and no redirects.

At startup the server verifies the newest signed index with registry trust and
verifies every indexed bundle with separate publisher trust. Index identity,
publisher, key, digest, and path must match each bundle. Invalid or expired
registry state prevents startup.

TLS certificate and key paths enable direct HTTPS. Plain HTTP requires an
explicit localhost-only option and exists for development and tests. Production
deployments may alternatively terminate TLS at a trusted reverse proxy, but the
reference command does not infer proxy security from headers.

## Non-Goals

M5 does not add browser administration, remote mutation APIs, multi-tenancy,
SSO, HSM custody, database storage, or automatic signing. Those are hosted
control-plane concerns. It also does not execute bundle content or weaken any
client-side verification performed by `aiba fetch`.
