# RFC 0021: Application Blueprint

Status: Accepted

## Decision

`ApplicationBlueprint` is AIBA's framework-neutral application intent contract.
It describes project-owned resources and fields, relationships, states and
transitions, operations, authorization intent, events and capability triggers,
UI intent, acceptance evidence, and bounded Agent write scopes.

A Blueprint is data, not generated application code. It cannot contain shell
commands, scripts, database queries, provider credentials, framework imports,
or executable hooks. AIBA Core validates and plans it deterministically but does
not execute capability packs or Agent tasks.

Business nouns exist only inside a user's Blueprint. They do not become AIBA
protocol interfaces or official capabilities merely because an example uses
them. Official protocols standardize reusable semantics such as authorization,
files, forms, tags, notifications, and audit.

## Validation

The public JSON Schema rejects unknown fields, unsafe paths, unbounded
collections, and malformed identifiers. Core additionally rejects duplicate or
dangling resources, fields, operations, events, UI references, relationships,
states, and transitions. Enum and reference fields must declare their required
dictionary or target resource exactly.

Blueprint metadata has its own semantic version. Planning binds the exact source
hash, resolved capability versions, manifests, and task graph so later upgrades
can distinguish application intent changes from project-owned implementation
customization.
