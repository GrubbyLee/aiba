# Organization Capability

`organization` defines safe membership changes without choosing a tenancy
library, database, or UI. Tenant and organization scope come from authenticated
context. Adapters validate users and roles, require revisions, deduplicate exact
mutations, preserve the final owner, and minimize records and audit.
