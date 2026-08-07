# form-engine - Security Test Plan

## Invariants to verify

| ID | Title | Severity |
|---|---|---|
| validation-is-server-side | Validation is always server-side | critical |
| schema-is-revisioned | Form schemas are revisioned | critical |
| fields-are-bounded | Field count and value size are bounded | critical |
| dependencies-are-acyclic | Field dependency rules are acyclic | error |
| uploads-are-scoped | File uploads in forms are scoped and bounded | error |

## Attack tests

1. **Client-forced bypass** - submit data that fails a required-field or
   regex constraint; verify the server rejects it even if the client
   claims it passed validation.
2. **Malformed schema injection** - submit a form payload containing extra fields
   not in the schema; verify they are stripped or rejected.
3. **Oversized submission** - send extremely long strings, deeply nested
   objects, or thousands of array items; verify the validator rejects
   with bounded limits.
4. **Stale revision submission** - submit against an outdated schema
   revision; verify the system either rejects or explicitly upgrades
   rather than silently validating against old rules.
5. **Dependency cycle** - define a schema where field A depends on B
   and B depends on A; verify schema definition is rejected.
6. **File reference tampering** - submit a form with a file ID that
   belongs to another tenant or form; verify the reference is rejected.
7. **ReDoS in pattern fields** - use pathological regex inputs against
   pattern-validated fields; verify validation completes in bounded time.
