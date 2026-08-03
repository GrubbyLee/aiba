# RFC 0012: Capability Taxonomy

Status: Accepted

## Context

AIBA began with reviewer access and an identity-oriented security foundation.
Those capabilities are an initial market wedge, not the product boundary. The
catalog needs a stable classification that can grow into integrations, business
behavior, engineering controls, and complete product compositions without
turning AIBA into a fixed application framework.

## Decision

Capability manifests may declare one `metadata.layer` value:

- `application-foundation`
- `platform-integration`
- `business-capability`
- `engineering-governance`
- `industry-solution`

The field is optional during v0alpha1 adoption so existing packs remain valid.
New official capability versions declare it. A separately version-bound
`CapabilityCatalog` classifies every official pack, including immutable versions
published before this field existed. Catalog entries cannot override a layer
embedded in a manifest, and their `id` and `version` must match that manifest.
Registry and discovery clients may filter on classification, but verification
semantics must never depend on presentation or catalog placement.

The first four layers describe independently installable capability contracts.
The fifth describes versioned compositions. A composition references exact
capabilities and dependency constraints; it cannot remove, replace, downgrade,
or mark optional an invariant required by a constituent capability.

## Admission Criteria

A catalog capability should satisfy at least three of these conditions:

1. It recurs across unrelated applications.
2. It crosses a system, trust, data, or provider boundary.
3. It has deterministic acceptance or security rules.
4. It requires installation provenance or evidence.
5. It has a meaningful lifecycle, migration, or upgrade path.

UI primitives, theme choices, and one-off product pages remain project-owned.
Recipes may guide their adaptation but capability contracts cannot prescribe a
visual system or application framework.

## Consequences

The catalog can grow beyond administration features while Core remains generic.
Provider adapters stay separate from stable business contracts. Industry
solutions become dependency compositions rather than large generated templates.
Catalog quality depends on conformance evidence, not the number of published
packs. Taxonomy backfills do not rewrite already published capability bytes.
