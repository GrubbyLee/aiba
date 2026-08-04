# External Consumer Trial

M6 includes an automated trial that behaves as an independent npm consumer,
without pnpm workspace links or source imports.

`scripts/release/verify-packages.mjs` builds release tarballs, installs all four
into a fresh system temporary directory through npm, imports each public library,
and runs the installed `aiba` binary. It verifies `--version`, initialization,
diagnostics, protocol negotiation, catalog discovery, resumable Solution state,
capability authoring, three shell completion formats, and structured runtime and
usage failures. These commands prove that packaged capabilities, Solutions, and
Agent contracts resolve independently of the repository checkout.

The same gate rejects tarballs containing `src`, compiled tests, source maps,
workspace dependency ranges, private keys, environment files, or missing
licenses and schemas. Run it with:

```bash
pnpm pack:check
```

This is the first reproducible external-project trial. A human beta in a real
Mini Program repository remains a product-validation activity after the private
npm prerelease is installed by an invited user.

CI runs the complete gate on Linux with Node.js 22 and 24. The portability job
also runs the compiled smoke and external npm consumer on macOS and Windows with
Node.js 24; POSIX permission-specific unit tests are not claimed on Windows.
