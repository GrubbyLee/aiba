# Core Capabilities Reference

This fixture is a framework-neutral TypeScript security corpus for AIBA's M3
capabilities: `identity`, `audit`, `authorization`, `users`, and `notification`.
Its modules use injected stores and adapters so the tests exercise capability
semantics rather than a chosen database or web framework.

The `.aiba/` state was produced through normal prepare/finalize commands. Each
capability records its source and attack-test evidence with Core-computed hashes.
Run `pnpm --filter @aiba/fixture-identity-reference test` for behavior and
`pnpm aiba verify --root fixtures/identity-reference --packs-dir capabilities`
for contract/provenance verification.

After changing an evidence file, run `pnpm build && pnpm fixture:core-state` to
regenerate the deterministic `.aiba/` plans, receipts, lock, and ancestry.
