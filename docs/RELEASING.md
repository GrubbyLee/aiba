# Release Process

## Package Topology

Release artifacts are published in dependency order:

1. `aiba-spec`: Apache-2.0 schemas and TypeScript bindings.
2. `aiba-core`: AGPL deterministic engine.
3. `aiba-registry-server`: AGPL reference server.
4. `aiba`: AGPL CLI plus official capability packs.

All four packages use the same version. The unscoped names avoid depending on
an npm organization that the project does not control. Name availability is not
reservation; the first publication reserves each name.

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
bootstrap fallback for the first publication and should be removed afterward.

Never publish from an uncommitted worktree or use mutable tags. npm versions are
immutable; a bad release is corrected with a new version and deprecation notice.
