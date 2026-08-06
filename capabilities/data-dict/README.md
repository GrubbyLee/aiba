# data-dict — Data Dictionary

Revisioned typed enum and lookup dictionaries for selectable values,
classifications, and status codes.

## What it provides

- Typed dictionary items (`string`, `number`, `boolean`) with display labels.
- Hierarchical dictionaries with parent-child relationships for cascading
  selectors like region → city → district.
- Per-dictionary revision tracking so records can reference the dictionary
  version they were validated against.
- Tenant-scoped isolation and admin-only mutation.
- Server-side validation of values against their dictionary type.

## What it does not provide

- A UI for dictionary management.
- Bulk import from spreadsheets (use `import-export` for that).
- Translation of labels per locale (use `i18n` for that).

## Interfaces

- `data-dict.query-command` / `data-dict.query-result` — list or search
  dictionary items with filters, pagination, and disabled-inclusion flag.
- `data-dict.item-record` — the validated shape of one dictionary entry.

## Quick start

```bash
aiba add data-dict
aiba verify
```

See [SECURITY_TESTS.md](SECURITY_TESTS.md) for adversarial coverage.
