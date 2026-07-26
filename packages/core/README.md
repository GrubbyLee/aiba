# aiba-core

Deterministic verification, provenance, signed bundle, registry, governance,
and customization-aware upgrade primitives for AIBA.

```ts
import { inspectProject, verifyProject } from "aiba-core";
```

Core never executes capability pack commands. Applications should normally use
the `aiba` CLI; this package is the supported library surface for integrations.

Requires Node.js 22 or newer. Licensed under AGPL-3.0-only.
