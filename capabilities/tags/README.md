# tags - Reusable Classification

Provides a headless tag catalog and safe resource assignments for projects that
need user-managed classification without committing to a UI or datastore.

## What it provides

- Tenant-unique normalized names and stable server-generated slugs.
- Create, update, and soft-archive lifecycle with optimistic revisions.
- Authorized, atomic attach and detach operations for arbitrary resource types.
- Idempotent mutations and bounded, signed-cursor queries.
- Sanitized names and strictly validated color metadata.

## What it does not provide

- Tag chips, pickers, autocomplete, or another fixed frontend component.
- Hierarchical taxonomy or policy roles; use a dedicated domain capability when
  parent-child classification changes business semantics.
- Hard deletion of historical assignments.

```bash
aiba add tags
aiba verify
```

See [SECURITY_TESTS.md](SECURITY_TESTS.md) for the adversarial checks.
