# External Consumer Trial

M6 includes an automated trial that behaves as an independent npm consumer,
without pnpm workspace links or source imports.

`scripts/release/verify-packages.mjs` builds release tarballs, installs all four
into a fresh system temporary directory through npm, imports each public library,
and runs the installed `aiba` binary. It verifies `--version`, `init`, `inspect`,
and `add identity`; the final command proves that the CLI's packaged official
capabilities resolve independently of the repository checkout.

The same gate rejects tarballs containing `src`, compiled tests, source maps,
workspace dependency ranges, private keys, environment files, or missing
licenses and schemas. Run it with:

```bash
pnpm pack:check
```

This is the first reproducible external-project trial. A human beta in a real
Mini Program repository remains a product-validation activity after the private
npm prerelease is installed by an invited user.

Last verified on 2026-07-26 with Node.js 24.14.0 and npm 11.9.0: four artifacts
installed, all library imports passed, and every CLI trial command exited zero.
