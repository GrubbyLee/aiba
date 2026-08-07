# Core Capabilities Reference

This fixture is a framework-neutral TypeScript conformance corpus for AIBA's
`identity`, `audit`, `authorization`, `users`, `notification`, `file-assets`,
`import-export`, and `wechat-miniprogram-auth` capabilities.
Its modules use injected stores and adapters so
the tests exercise capability semantics rather than a chosen database, object
store, parser, queue, or web framework.

The `.aiba/` state was produced through normal prepare/finalize commands. Each
capability records its source and attack-test evidence with Core-computed hashes.
Run `pnpm --filter @aiba/fixture-identity-reference test` for behavior and
`pnpm aiba verify --root fixtures/identity-reference --packs-dir capabilities`
for contract/provenance verification.

It is also the passing composition fixture for:

```bash
pnpm aiba compose secure-workspace --root fixtures/identity-reference
```

After changing an evidence file, run `pnpm build && pnpm fixture:core-state` to
regenerate the deterministic `.aiba/` plans, receipts, lock, and ancestry.

The native Mini Program authentication client lives in
`fixtures/review-access-wechat-native`.
