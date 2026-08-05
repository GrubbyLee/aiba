# Verification Challenge Capability

`verification-challenge` defines single-use email, SMS, and authenticator
verification without selecting a provider or UI. Recipient lookup, tenant,
purpose, destination, templates, limits, and cryptographic pepper remain trusted
server policy.

Adapters must make known and unknown recipients indistinguishable, persist only
keyed response digests, consume success atomically, bound issuance and attempts,
deduplicate exact issue commands, and keep all secrets and identifiers out of
portable records and audit.
