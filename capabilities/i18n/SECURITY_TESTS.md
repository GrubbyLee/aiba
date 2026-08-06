# i18n — Security Test Plan

## Invariants to verify

| ID | Title | Severity |
|---|---|---|
| locale-is-trusted | Resolved locale is server-side trusted | critical |
| keys-are-namespaced | Translation keys are namespaced and bounded | high |
| interpolation-is-sanitized | Parameter interpolation is sanitized | critical |
| catalog-is-revisioned | Catalogs are revisioned and immutable per release | high |
| fallback-is-deterministic | Fallback chain is deterministic and bounded | medium |
| plural-rules-are-validated | Plural rules are validated against locale | medium |

## Attack tests

1. **Client-forged locale** — a client submits `X-Locale: admin-override`
   or similar; verify the resolved locale comes only from the
   authenticated preference, tenant default, and negotiated
   `Accept-Language` list.
2. **Path traversal in key name** — supply keys containing `../`,
   absolute paths, or null bytes; verify the lookup rejects them or
   returns a generic fallback without leaking catalog internals.
3. **HTML / script injection in parameters** — pass `<script>`,
   `javascript:`, and template-injection payloads as interpolation
   values; verify output is escaped or stripped per output mode.
4. **Malformed plural forms** — provide a bundle declaring a locale but
   using plural categories that locale does not have; verify the
   catalog validator rejects it.
5. **Unbounded fallback recursion** — construct a key that triggers
   fallback through many levels; verify the chain is capped and
   terminates in the source locale.
6. **Catalog mutation under same revision** — update bundle content
   without changing the revision identifier; verify the validator
   detects the hash mismatch.
7. **Missing namespace** — request a key from a nonexistent namespace;
   verify the response is a bounded fallback, not a stack trace or
   schema leak.

## Reference implementation expectations

- Locale resolution function is pure and unit-testable without I/O.
- Interpolation function accepts a sanitizer and the default sanitizer
  escapes HTML-special characters.
- Catalog loading rejects any bundle whose content hash does not
  match its declared revision.
- Plural validation uses a fixed CLDR category map per supported locale.
