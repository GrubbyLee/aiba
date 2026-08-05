# Search Capability

`search` defines a bounded, provider-neutral search boundary. Tenant and
principal are trusted context, searchable resource types and projections are
server-owned, and authorization filtering occurs before ranking or pagination.
Signed opaque cursors bind traversal to the exact caller and normalized query.
