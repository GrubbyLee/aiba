# Import Export Capability

`import-export` runs profile-bound data exchange inside a trusted tenant. Import
sources and export results are private file assets. Server-owned profiles define
formats, fields, limits, validation, and data targets so callers cannot select a
table, query, mapping, provider location, or callback.

The contract does not prescribe CSV libraries, job queues, databases, object
storage, or admin UI. Adapters must preserve bounded processing, atomic import
semantics, export policy, spreadsheet-formula neutralization, idempotency, and
minimized job records.
