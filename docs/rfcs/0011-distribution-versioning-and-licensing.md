# RFC 0011: Distribution, Versioning, And Generated Output

Status: Accepted for M6 implementation

## Decision

AIBA ships as four lockstep npm packages: `aiba-spec`, `aiba-core`,
`aiba-registry-server`, and `aiba`. The CLI package carries official capability
packs so its short default workflow works outside this monorepo. Internal
workspace ranges are rewritten to ordinary SemVer in release tarballs.

The package version governs JavaScript and CLI compatibility. Protocol
documents retain their independent `apiVersion`, and capability packs retain
their independent SemVer. This prevents npm release cadence from silently
becoming a wire-protocol or capability-contract version.

## License Boundary

Core, CLI, Registry Server, capability contracts, recipes, and migrations are
AGPL-3.0-only and remain eligible for a separate license from their
copyright holders. The protocol package is Apache-2.0 so independent tools can
interoperate without copying Core.

Application output must not inherit AGPL merely because AIBA or an Agent created
it. `GENERATED_OUTPUT_EXCEPTION.md` grants an additional permission for output
material identified by operation plans or ancestry records, while excluding
AIBA itself and third-party material. The exception documents project intent
and must receive qualified legal review before a broad public launch.

## Release Trust

The repository, not a developer laptop, is the release builder. An annotated
`vX.Y.Z` tag must match every package version and changelog section. GitHub
Actions runs all checks, generates npm tarballs, publishes in dependency order
with provenance, and creates release notes from the changelog. The protected
`npm` environment supplies reviewer approval and OIDC identity.

Tarballs are allowlisted release artifacts. They include compiled JavaScript,
declarations, licenses, documentation, schemas where applicable, and official
packs in the CLI. They exclude sources, tests, source maps, secrets, fixtures,
and workspace-only dependency ranges.

## Failure And Recovery

npm publication is not atomic across packages. The publisher therefore checks
the SHA-512 integrity of an already-published version and resumes only when its
bytes match the local artifact. Published versions are never overwritten. Any
incompatible or faulty publication is corrected with a new SemVer release.
