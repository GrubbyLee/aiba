# @grubbylee/aiba

The official AIBA command-line interface for installing, verifying, tracing,
and upgrading application capabilities with AI Agents.

```bash
npm install --global @grubbylee/aiba
aiba init
aiba add identity
aiba inspect
aiba completion bash
```

The scoped npm package installs the unscoped `aiba` executable shown above.

The package includes the official capability packs. Use `--packs-dir` to select
a different trusted local pack directory. Capability packs are treated as
untrusted data and are never executed by Core.

Requires Node.js 22 or newer. AIBA is licensed under AGPL-3.0-only with the
[generated-output exception](./GENERATED_OUTPUT_EXCEPTION.md).
