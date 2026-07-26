# Self-Hosting The AIBA Registry

The reference registry is a signed-file distribution service. Clients remain
responsible for local signature, integrity, semantic, and rollback verification.

## Prerequisites

- A built `aiba` CLI on Node.js 22 or newer.
- Separate publisher and registry-operator Ed25519 keys.
- Publisher and registry trust-policy JSON files.
- A high-entropy read token provisioned through the process environment.
- A TLS certificate and owner-only (`0600`) private key for direct HTTPS.

Keep all private keys outside the registry root. The read token is not a signing
key and must never appear in command arguments, logs, Git, or registry files.

## Publish A Bundle

Create an empty registry and import a bundle already signed by its publisher:

```bash
mkdir registry
aiba registry-add ./identity.aiba \
  --registry ./registry \
  --publisher-trust ./publisher-trust.json
```

Import verifies the source, copies it into registry-owned staging, verifies the
copy, and atomically publishes it. Repeating equal content is safe. A different
signed bundle claiming the same capability version is rejected and requires a
new semantic version.

Create the next immutable client-visible index only after all intended bundles
are present:

```bash
aiba registry-index ./registry \
  --id company-registry \
  --publisher registry-operator \
  --key-id root-1 \
  --private-key /secure/registry-operator/private.pem \
  --publisher-trust ./publisher-trust.json \
  --sequence 1 \
  --expires-at 2026-08-02T00:00:00Z
```

Never reuse or remove a published sequence. Use a short operationally realistic
expiry and publish a higher sequence before it expires.

## Serve

Provision `AIBA_REGISTRY_TOKEN` through the service manager, then run direct TLS:

```bash
aiba registry-serve ./registry \
  --host 0.0.0.0 --port 7443 \
  --registry-trust ./registry-trust.json \
  --publisher-trust ./publisher-trust.json \
  --tls-cert /secure/tls/fullchain.pem \
  --tls-key /secure/tls/private.pem
```

The command verifies the latest signed index and every indexed bundle before
opening the socket. It exposes only verified, indexed v0 routes. To load a newly
published sequence, perform a graceful restart after `registry-index` succeeds.

For a same-host reverse proxy, bind AIBA to `127.0.0.1` and explicitly add
`--allow-insecure-localhost`; terminate and authenticate external TLS at the
proxy. AIBA refuses plaintext binding to non-loopback addresses.

## Fetch

Give clients both trust policies through a trusted channel, provision their read
token, and run:

```bash
aiba fetch identity \
  --registry-url https://registry.example.com \
  --registry-trust ./registry-trust.json \
  --publisher-trust ./publisher-trust.json
```

Persist `.aiba/registry-state.json` to retain rollback protection. The derived
`.aiba/registry-cache/` can be cleared and rebuilt, but must not replace or reset
the trusted state file.

## Operational Boundary

The reference server has no upload, signing, administration, health, or browser
API. Protect filesystem mutation and operator commands with normal host access
controls. Multi-tenancy, SSO, HSM custody, approval UX, audit retention, hot
reload, rate limiting, and managed availability remain hosted control-plane
features rather than local verification shortcuts.
