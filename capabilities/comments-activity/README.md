# Comments and Activity Capability

`comments-activity` defines attributable discussion around arbitrary resources.
Comments are bounded, revisioned, idempotent, and soft deleted. Mentions resolve
inside trusted tenant scope. Each mutation appends a minimized immutable activity
record, and activity reads are authorized before tenant-scoped filtering.
