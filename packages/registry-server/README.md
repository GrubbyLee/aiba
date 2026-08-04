# aiba-registry-server

The authenticated, read-only reference registry server for AIBA capability
bundles. It verifies the latest signed index and every indexed bundle before
accepting traffic.

```ts
import { createRegistryServer } from "aiba-registry-server";
```

For normal operation, use `aiba registry-serve`. The server exposes no remote
mutation or signing API. Requires Node.js 22 or newer and is licensed under
AGPL-3.0-only.

Authenticated health, readiness, and Prometheus metrics are available at
`/healthz`, `/readyz`, and `/metrics`. Local verified backup, restore, and
retention commands remain in the CLI rather than remote server routes.
