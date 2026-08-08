# RFC 0009: Private Registry Transport And Hosted Control Boundary

Status: Accepted for M4.4 implementation

## Purpose

Fetch capability packs from authenticated private registries without making the
registry server, transport, or cache a new trust root. Preserve a complete local
verification path in AGPL AIBA Core while defining a hosted control
plane that adds operational value rather than weaker verification.

## Transport Protocol

The client reads a bearer token from a named environment variable. Tokens are
never accepted as command arguments, written to cache, or included in results.
HTTPS is mandatory; an explicit HTTP exception exists only for localhost tests.
Redirects are rejected so credentials cannot be forwarded to another origin.
Requests have strict timeouts and streaming size limits.

The v0 read API is:

```text
GET /v0/indexes/latest.json
GET /v0/indexes/<sequence>/index.json
GET /v0/indexes/<sequence>/index.sig.json
GET /v0/bundles/<capability>/<version>/bundle.json
GET /v0/bundles/<capability>/<version>/bundle.sig.json
GET /v0/bundles/<capability>/<version>/pack/...
```

`latest.json` is only a hint. Core trusts a sequence after verifying its signed
index against local registry trust. It then selects an entry, verifies the
bundle envelope against separate publisher trust, and downloads only the signed
allowlisted paths at their exact declared sizes. Full bundle integrity and
semantic verification runs before directories are atomically published to the
cache. Conflicting cache entries, rollback, and same-sequence equivocation fail
closed. Anti-rollback state advances only after cached resolution succeeds.

## Open Core Boundary

AGPL AIBA Core remains a complete local verifier. It includes schemas, signing
verification, HTTPS transport, verified caching, anti-rollback state, local
governance, provenance, and deterministic CLI exit codes. A user can operate a
registry and verify every artifact without buying or contacting an AIBA-hosted
service. Hosted responses cannot declare an artifact valid or bypass
`aiba verify-bundle`, `aiba policy-check`, or `aiba verify`.

## Hosted Control Plane

The paid product may provide multi-tenant private registry hosting, SSO and
SCIM, HSM-backed publisher and approver key custody, protected publishing
workflows, remote approval UX, immutable audit retention, enterprise system
integrations, policy distribution, availability guarantees, and support. Remote
approvals must export ordinary signed AIBA approval records that Core can verify
offline. Hosted identity and attestation may strengthen who performed an action,
but cannot weaken local signatures, thresholds, evidence hashes, or rollback
checks.

Hosted distribution uses a separate license for customers that do not want
AGPL obligations. Protocol interoperability and generated project ownership
must remain available independently of the hosted service.

## Agent Boundary

Agent Skills may call `aiba fetch` with user-configured URLs, trust policies,
cache paths, and token environment-variable names. Agents must never request,
read, print, persist, or transmit the token value, publisher private keys, or
approver private keys. Fetching a verified pack does not authorize executing it;
the normal bounded prepare, adapt, finalize, and verify workflow still applies.
