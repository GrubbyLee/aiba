# Changelog

All notable changes to AIBA are documented here. The format follows Keep a
Changelog, and package versions follow Semantic Versioning.

## [Unreleased]

## [0.1.0] - 2026-07-26

### Added

- Agent-assisted install, deterministic verification, provenance receipts, and
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

[Unreleased]: https://github.com/GrubbyLee/ai-base/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/GrubbyLee/ai-base/releases/tag/v0.1.0
