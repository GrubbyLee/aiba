# Release Process

## Package Topology

Release artifacts are published in dependency order:

1. `aiba-spec`: Apache-2.0 schemas and TypeScript bindings.
2. `aiba-core`: AGPL deterministic engine.
3. `aiba-registry-server`: AGPL reference server.
4. `@grubbylee/aiba`: AGPL CLI plus official capability packs. It installs the
   unscoped `aiba` executable.

All four packages use the same version. The CLI is scoped because npm's package
name similarity protection rejects the unscoped `aiba` name. The library names
remain unscoped.

## Local Release Gate

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm pack:artifacts
```

`pnpm check` builds and tests the workspace, then creates four tarballs in a
temporary directory, scans their allowlisted contents, installs them together
in a clean non-workspace npm project, imports every library, and exercises the
installed CLI. `pnpm pack:artifacts` creates the exact releasable tarballs in
`artifacts/`.

## Publishing

1. Update the root and four package versions together.
2. Move release notes from `Unreleased` into a dated version in `CHANGELOG.md`.
3. Run `pnpm check` and review `npm pack` contents.
4. Commit with `chore(release): prepare vX.Y.Z`.
5. Create an annotated tag: `git tag -a vX.Y.Z -m "AIBA vX.Y.Z"`.
6. Push the commit, then the tag only after explicit release approval.

The tag workflow re-runs every gate, publishes with npm provenance, checks an
existing version's tarball integrity before resuming a partial release, and
creates or updates a GitHub Release from the matching changelog section. A
failed publication can be retried without moving the tag through the workflow's
manual `tag` input. Protect the `npm` GitHub environment with required
reviewers. Configure npm Trusted Publishing; the `NPM_TOKEN` secret is only a
bootstrap credential for the first publication and is not read by the release
workflow. Remove it after bootstrap so release authentication has one source of
truth.

Configure each npm package with this trusted publisher before the next tag:

- Organization or user: `GrubbyLee`
- Repository: `ai-base`
- Workflow filename: `release.yml`
- Environment: `npm`

Open the package settings while signed in as an npm package owner, select
**Trusted Publisher**, choose **GitHub Actions**, and enter the values above:

| Package | npm settings |
| --- | --- |
| `@grubbylee/aiba` | <https://www.npmjs.com/package/@grubbylee/aiba/access> |
| `aiba-core` | <https://www.npmjs.com/package/aiba-core/access> |
| `aiba-spec` | <https://www.npmjs.com/package/aiba-spec/access> |
| `aiba-registry-server` | <https://www.npmjs.com/package/aiba-registry-server/access> |

npm does not currently expose this package-owner operation through its CLI, so
the four website changes are intentionally manual. Run `pnpm
release:oidc-check` to audit the repository half of the trust relationship. A
successful check cannot prove the npm-side bindings exist; verify each package
settings page shows the publisher before creating the next version tag. The
first new version published by `release.yml` is the end-to-end proof.

Never publish from an uncommitted worktree or use mutable tags. npm versions are
immutable; a bad release is corrected with a new version and deprecation notice.
