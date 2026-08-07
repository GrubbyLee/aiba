# Inbox Security Test Plan

- [x] Context-derived tenant and recipient scope prevents cross-principal reads
- [x] Malformed commands cannot inject recipient, tenant, or arbitrary content
- [x] Trusted templates are versioned and rendered with bounded parameters
- [x] Unauthorized list and transition requests fail closed
- [x] Page size is bounded and cursor tamper or cross-principal replay is rejected
- [x] Exact revisions make batch transitions atomic on stale or missing messages
- [x] Exact idempotency replay succeeds and changed key reuse conflicts
- [x] Archived messages cannot be reopened through state transition races
- [x] Message output and audit omit recipient, parameters, and provider data
