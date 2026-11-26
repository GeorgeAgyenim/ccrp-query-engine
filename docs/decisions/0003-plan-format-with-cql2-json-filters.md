# ADR-0003: The plan is versioned JSON; its attribute filters use a subset of CQL2-JSON, everything else is plan operations

- Status: Accepted (one-way door: the plan is the contract between the builder, the assistant, the
  compiler, shared links and the research benchmark)
- Date: 2026-11-26
- Ported from: Colouring Ghana ADR-0014 (2026-11-26; not public)
- Deciders: proposed by Claude (Anthropic) as engineer; accepted by the first host's product owner
- Related: ADR-0002 (field catalogue), ADR-0005 (spatial rules)

## Context

A question needs one structured form, the **plan**: a declared area, an ordered list of operations from a
fixed vocabulary, and declared outputs. The research behind the engine asks for an assessment of OGC CQL2
(standard 21-065r2) as the filter part of that plan. CQL2 defines attribute comparisons, sets and ranges,
array functions, spatial predicates, custom functions and three-valued logic for unknowns, with a JSON
encoding. It has no grouping, aggregation, ranking or buffer operation. Its spatial predicates compare whole
geometries, which does not match the engine's rule of placing a building by one point on its footprint
(ADR-0005).

The assistant refers to map things by name ("the selected building", "this view", "Area A"). Only the
browser knows what those currently are.

## Decision

- **Versioning:** a plan is JSON with a semantic version and a published JSON Schema.
- **Structure:** one area (a map reference), ordered steps and one or more outputs. The step vocabulary:
  area, filter, buffer, spatial relate, aggregate, compare, rank, completeness; outputs are number, map,
  table, chart and dataset.
- **Two forms:**
  - An *unresolved* plan may name map references symbolically.
  - A *resolved* plan holds concrete values: a layer and feature key, a building id, a viewport box, or a
    drawn shape's geometry.
  - Only resolved plans compile. Shared links and saved results carry resolved plans.
- **Filters use CQL2-JSON**, restricted to:
  - Basic CQL2 (comparisons, AND / OR / NOT, three-valued logic);
  - the advanced comparison operators BETWEEN and IN;
  - the array functions (for multi-valued fields such as land-use group);
  - two custom functions, `recorded` and `blank`. They test a field using the field catalogue's
    missing-value rules (ADR-0002), not plain SQL null. CQL2's plain null test is not offered, because it
    would count a default value as recorded.
- **Outside CQL2:** spatial scope, buffer, spatial relate, aggregate, compare, rank, completeness and
  outputs. They are plan operations, so CQL2's spatial, temporal and arithmetic classes are not adopted.

## Alternatives considered

| Alternative | What it would have meant | Why not |
|---|---|---|
| CQL2 for spatial too | Areas and relations as CQL2 spatial functions | Whole-geometry predicates differ from the point-on-surface membership rule; still no aggregation |
| A home-made filter grammar | Our own JSON for comparisons | Reinvents a published standard with documented three-valued logic; no reuse outside the engine |
| SQL fragments in the plan | The builder or assistant writes WHERE clauses | Cannot be validated against the catalogue; breaks "one path from question to execution" |
| Resolve map references in the assistant | The model receives coordinates and ids | Sends map state to the model; the research tests resolution as its own step |

## Consequences

- A plan made by clicking and one made by the assistant can be compared field by field.
- Adding an operator or function is a schema version change and a new decision record.
- The plan can be handed to a future in-browser engine unchanged (ADR-0001).

## Plain-English summary

Every question, whether clicked or typed, is written down in one fixed, checkable format called a plan.
The part that says which building details must match uses an international standard for map-data filters
(CQL2), so it is precise and familiar to GIS people. The parts that standard cannot express, such as counting
by area or distances, are the engine's own steps. A plan names places on the map in words until the moment it
runs, when the map fills in exactly which area was meant.
