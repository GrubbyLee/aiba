# aiba-spec

Language-neutral AIBA JSON Schemas and their TypeScript bindings.

```ts
import { AIBA_API_VERSION, loadProtocolSchema } from "aiba-spec";
import capabilitySchema from "aiba-spec/schema/capability.schema.json" with { type: "json" };
```

JSON Schema is the protocol source of truth. Protocol versioning is independent
from npm package versioning; inspect each document's `apiVersion` before use.
`CapabilityCatalog` classifies exact capability versions without requiring
metadata changes to immutable legacy manifests. `CapabilitySolution` composes
exact manifest hashes in dependency order without an invariant-override field.
Portable interfaces now cover files, import/export, application workflows, and
a secret-free WeChat Mini Program login command/result boundary.

Requires Node.js 22 or newer. Licensed under Apache-2.0 to support independent
implementations and ecosystem interoperability.
