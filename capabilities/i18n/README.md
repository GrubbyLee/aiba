# i18n — Internationalization

Namespaced, revisioned translation catalogs with deterministic locale
resolution and parameter interpolation.

## What it provides

- Translation lookup with a bounded fallback chain per locale.
- Parameter interpolation with output-sanitized values.
- Plural form selection using CLDR plural categories.
- Content-addressable catalog revisions so active translations never
  silently change under a deployed revision.
- Server-side locale resolution from authenticated preferences, tenant
  defaults, and `Accept-Language` negotiation.

## What it does not provide

- A translation management UI or workflow.
- A specific message format — the contract works with ICU,
  gettext-style, or simple key-value catalogs.
- Automatic machine translation.

## Interfaces

- `i18n.translate-command` / `i18n.translate-result` — translate one
  key or a batch of keys with context.
- `i18n.catalog-command` / `i18n.catalog-result` — fetch or validate
  a translation bundle by revision.

## Quick start

```bash
aiba add i18n
aiba verify
```

See [SECURITY_TESTS.md](SECURITY_TESTS.md) for attack surface and
adversarial test coverage.
