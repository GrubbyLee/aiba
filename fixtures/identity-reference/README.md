# Core Capabilities Reference

This fixture is a framework-neutral TypeScript conformance corpus for AIBA's
`identity`, `audit`, `authorization`, `users`, `notification`, `file-assets`,
`import-export`, `vehicle-records`, and `wechat-miniprogram-auth` capabilities.
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
pnpm aiba compose vehicle-management --root fixtures/identity-reference
```

After changing an evidence file, run `pnpm build && pnpm fixture:core-state` to
regenerate the deterministic `.aiba/` plans, receipts, lock, and ancestry.

M7 portability adapters are also colocated here: `vehicle-records-http.ts` is
the TypeScript API boundary and `web-admin/` is a functional framework-free
admin client. The native client lives in `fixtures/review-access-wechat-native`.
