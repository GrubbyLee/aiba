# Tags Security Test Plan

- [x] Context-derived tenant prevents cross-tenant catalog and assignment access
- [x] Malformed commands cannot inject tenant, actor, raw query, or resource payloads
- [x] Unauthorized catalog, mutation, and assignment operations fail closed
- [x] Case, Unicode normalization, and whitespace variants cannot bypass uniqueness
- [x] Unsafe names are sanitized and color metadata is allowlisted
- [x] Stale tag and assignment revisions reject without partial mutation
- [x] Exact idempotency replay succeeds and changed key reuse conflicts
- [x] Cross-tenant, unknown, and archived tags cannot be newly attached
- [x] Archived tags retain history but cannot be ordinary-update restored
- [x] Page bounds, cursor tamper, and cross-scope cursor replay are rejected
- [x] Audit records omit names, tenant values, resource payloads, and actor details
