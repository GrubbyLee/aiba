# AIBA

AIBA is an agent-native application capability system. It helps AI agents add,
verify, trace, and upgrade cross-cutting application capabilities without
forcing projects into a fixed application framework or visual system.

The project is in its initial implementation phase. The first capability is
`review-access`, a constrained identity path for external application reviewers.

## Principles

- Stable capability semantics, flexible implementation.
- Deterministic verification, AI-assisted adaptation.
- Project-owned generated code.
- Traceable changes and upgradeable capabilities.
- Independent core with thin Agent skill adapters.

## Repository

- `docs/`: vision, architecture, RFCs, roadmap, and task progress.
- `packages/spec`: language-neutral schemas and TypeScript protocol types.
- `packages/core`: inspection, capability loading, provenance, and verification.
- `packages/cli`: the `aiba` command-line interface.
- `capabilities/`: official capability packs.
- `integrations/`: Agent-specific adapters.
- `fixtures/`: reference projects used for conformance and attack testing,
  including a native WeChat Mini Program.

## Development

```bash
pnpm install
pnpm check
node packages/cli/dist/index.js init /path/to/project
node packages/cli/dist/index.js inspect .
node packages/cli/dist/index.js add review-access --root /path/to/project
node packages/cli/dist/index.js add review-access --finalize --root /path/to/project
node packages/cli/dist/index.js verify review-access \
  --root fixtures/review-access-reference \
  --packs-dir capabilities
```

See [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/TASKS.md](docs/TASKS.md) for
the current implementation status.
