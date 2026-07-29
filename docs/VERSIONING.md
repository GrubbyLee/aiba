# Version And Compatibility Policy

## Package Versions

`@grubbylee/aiba`, `aiba-core`, `aiba-spec`, and `aiba-registry-server` use one
lockstep Semantic Version. Before 1.0, patch releases are backward compatible
and minor releases may contain announced breaking changes. After 1.0, breaking
public API or CLI changes require a major release.

The CLI's command names, exit-code meaning, and documented `--json` fields are
public API. Fields may be added in compatible releases; consumers must ignore
unknown fields. Removing or changing a field is breaking. Human-readable output
is not a parsing contract.

Node.js 22 is the minimum runtime. CI also tests Node.js 24. Dropping a supported
Node major requires at least a minor release before 1.0 and a major release
after 1.0.

## Protocol Versions

Protocol documents declare an `apiVersion` independently of npm versions.
`aiba.dev/v0alpha1` is experimental: a package minor release may change it.
Incompatible stable protocols receive a new value, such as `aiba.dev/v1`, and
must coexist for a documented migration window. Readers reject unsupported
versions rather than guessing.

Registry HTTP routes follow the same rule. Incompatible `/v0` changes use a new
route prefix. Capability packs and migrations have their own SemVer and remain
independent from package releases.

## Deprecation

Before 1.0, deprecated public behavior remains for at least one subsequent minor
release when security permits. After 1.0, it remains for at least one major
release. Security fixes may remove unsafe behavior immediately and must be
called out in `CHANGELOG.md`.
