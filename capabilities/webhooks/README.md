# Webhooks Capability

`webhooks` sends server-projected events to tenant-bound trusted subscriptions.
Commands never contain destinations, secrets, headers, or arbitrary payloads.
Adapters sign exact bodies, enforce timestamp and replay checks at receivers,
deduplicate enqueue, bound retries, and minimize public delivery records.
