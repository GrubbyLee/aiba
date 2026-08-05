# Notification Capability

`notification` sends authorized, tenant-scoped, explicitly versioned template
commands to trusted recipient references. It enforces consent and preferences,
durable idempotency, persisted delivery lifecycle, bounded parameters, minimized
receipts, and redacted delivery audit events.

It does not expose provider credentials, choose a vendor, or prescribe a message UI.

Version `0.2.0` requires `templateVersion` and adds lifecycle fields to receipts.
Use `migrations/0.1.0-to-0.2.0.yaml` when upgrading adapted implementations.
