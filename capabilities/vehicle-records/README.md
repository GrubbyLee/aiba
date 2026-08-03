# Vehicle Records Capability

`vehicle-records` defines the secure domain boundary for vehicle creation,
lookup, listing, mileage updates, and lifecycle status changes. It is independent
of UI framework, transport, database, and deployment provider.

The contract treats tenant identity, authorization, opaque IDs, normalized
unique vehicle identifiers, optimistic concurrency, idempotency, and atomic
audit as mandatory behavior. The TypeScript recipe describes adaptation and
evidence requirements without executing pack-provided code.
