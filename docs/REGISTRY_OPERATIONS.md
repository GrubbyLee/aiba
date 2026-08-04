# Registry Operations

The reference Registry remains a read-only signed-file service. Its operational
tools run locally with filesystem access; there is no remote mutation API.

## Observe

Authenticated endpoints are available on the same listener:

- `/healthz`: process health.
- `/readyz`: verified Registry identity and loaded sequence.
- `/metrics`: Prometheus counters without tokens, paths, capability names, or
  client identifiers.

Set `--request-limit` to cap authenticated requests per process per minute.
Unauthorized requests do not consume legitimate-client quota but are counted.

## Backup And Restore

```bash
aiba registry-backup ./registry --out ./backup-2026-08-05 \
  --registry-trust ./registry-trust.json \
  --publisher-trust ./publisher-trust.json

aiba registry-restore ./backup-2026-08-05 --out ./registry-restored \
  --registry-trust ./registry-trust.json \
  --publisher-trust ./publisher-trust.json
```

Backup verifies every signed index and referenced publisher bundle before
copying. The manifest binds every relative path, byte size, and SHA-256. Restore
rejects extra, missing, changed, linked, or special files and writes only to a
new target. Test restores regularly before relying on a backup.

## Retention

Preview first:

```bash
aiba registry-gc ./registry --keep-indexes 30 \
  --registry-trust ./registry-trust.json \
  --publisher-trust ./publisher-trust.json
```

Add `--apply` only after reviewing the JSON report and retaining a verified
backup. GC keeps the latest N signed indexes and their complete bundle closure.
It never deletes a bundle referenced by a retained index.

The hardened container example is under `deploy/registry/`. Pin
`AIBA_VERSION`, mount the Registry and policies read-only, provide TLS files,
and inject only the bearer token through the environment. Hosted multi-tenancy,
SSO, HSM custody, billing, and availability management remain separate services.
