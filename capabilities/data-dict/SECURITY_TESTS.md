# data-dict — Security Test Plan

## Invariants to verify

| ID | Title | Severity |
|---|---|---|
| values-are-bound | Dictionary values are bounded and typed | critical |
| tenant-isolation | Dictionaries are tenant-isolated | critical |
| revisions-are-immutable | Dictionary revisions are immutable | error |
| disabled-items-excluded | Disabled items are excluded from user queries | error |
| labels-are-sanitized | Display labels are sanitized | error |

## Attack tests

1. **Cross-tenant leak** — query a dictionary with another tenant's dict ID
   or item ID; verify empty result or explicit denial.
2. **Type confusion** — store a string value in a number-typed dictionary
   via crafted request; verify the service rejects it.
3. **Disabled item leak** — list a dictionary as an unprivileged caller;
   verify items marked `disabled: true` are absent.
4. **XSS in display label** — store a label with HTML / script payloads;
   verify sanitized output in query results.
5. **Revision mutation** — attempt to update a dictionary without
   incrementing the revision; verify the operation is rejected or the
   revision advances atomically.
6. **Hierarchy cycle** — create a parent-child cycle; verify the service
   detects and rejects it.
7. **Bulk query abuse** — request page size beyond the limit or an
   extremely deep cursor; verify the query is bounded and fails fast.
