# Changelog

All notable changes to AIBA are documented here. The format follows Keep a
Changelog, and package versions follow Semantic Versioning.

## [Unreleased]

## [0.1.2] - 2026-08-04

### Added

- Add verified discovery and guided installation for hash-bound Solution
  compositions, including the `aiba list` and `aiba show` commands.
- Add official `file-assets`, `import-export`, `vehicle-records`, and
  `wechat-miniprogram-auth` capabilities with adversarial conformance tests.
- Add the `vehicle-management` Solution and reference TypeScript API, web admin,
  and native WeChat Mini Program clients.
- Add bilingual project documentation, new AIBA branding, and an online product
  walkthrough hosted by GitHub Pages.

### Changed

- Define AIBA as Agent Infrastructure for Building Applications and align the
  public product positioning across documentation and package metadata.
- Rename the GitHub and Gitee repositories from `ai-base` to `aiba`, and rebind
  all npm Trusted Publishers to the renamed GitHub repository.

### Security

- Bind Solution constituents to verified capability manifests and dependency
  graphs, reject catalog conflicts and evidence drift, and preserve explicit
  per-capability plans during guided installation.

## [0.1.1] - 2026-07-29

### Fixed

- Publish the CLI as `@grubbylee/aiba` because npm rejects the unscoped `aiba`
  name under its package-name similarity protection. The installed executable
  remains `aiba`.
- Support scoped package names throughout deterministic artifact creation,
  verification, and resumable publication.
- Use npm Trusted Publishing through GitHub OIDC instead of a long-lived npm
  token in the release workflow.

## [0.1.0] - 2026-07-27

### Added

- Agent-assisted install, deterministic evidence/provenance verification, receipts, and
  customization-aware capability upgrades.
- Official `review-access`, `identity`, `users`, `authorization`, `audit`, and
  `notification` capability contracts and recipes.
- Signed capability bundles, signed registry indexes, anti-rollback state,
  authenticated fetching, verified caching, and signed team approvals.
- Authenticated read-only self-hosted reference registry with direct TLS.
- Installable `aiba`, `aiba-core`, `aiba-spec`, and `aiba-registry-server` npm
  packages with a clean-project consumer test.
- Apache-2.0 protocol package and an explicit generated-output exception for
  project application code.
- Tag-driven npm provenance and GitHub Release pipeline.

### Security

- Reject path traversal, symlinks, executable pack payloads, stale evidence,
  malformed manifests, tampered signatures, registry rollback, redirects,
  oversized responses, untrusted keys, and insecure non-loopback listeners.

[Unreleased]: https://github.com/GrubbyLee/aiba/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/GrubbyLee/aiba/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/GrubbyLee/aiba/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/GrubbyLee/aiba/releases/tag/v0.1.0
