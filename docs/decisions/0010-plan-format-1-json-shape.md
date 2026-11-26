# ADR-0010: Plan format 1.0.0: a viewport area, filter steps in a CQL2-JSON subset, and a number output

- Status: Accepted 2026-11-26 (one-way door: builders, the assistant, shared links and the research benchmark write
  plans in this shape)
- Date: 2026-11-26
- Origin: new in the engine repository (query-engine ticket 02); makes ADR-0003 concrete
- Deciders: proposed by Claude (Anthropic) as engineer; accepted by the product owner 2026-11-26
- Related: ADR-0002 (field catalogue), ADR-0003 (plan format), ADR-0005 (membership), ADR-0009 (catalogue)

## Context

ADR-0003 fixes the plan's parts (one area, ordered steps, one or more outputs), its versioning and the CQL2
subset for filters, but not the JSON. The first plans the engine runs count buildings in the current view
that meet attribute conditions. Later tickets add districts, drawn shapes, buffers, grouping and more outputs,
so the shape must grow by addition.

OGC CQL2 1.0 (21-065r2) encodes a condition as `{"op": <operator>, "args": [...]}`, a field as
`{"property": <name>}`, `between` as three arguments, `in` as a value and a list, and a function call the same
way as an operator. Its array functions compare sets: `a_equals` is set equality.

## Decision

A plan is a JSON object with exactly four members, published as `schemas/plan-1.schema.json`
(JSON Schema 2020-12):

```json
{
  "version": "1.0.0",
  "area": { "type": "viewport", "bbox": [0, 0.0009, 0.0009, 0.0018] },
  "steps": [
    { "type": "filter",
      "filter": { "op": "and", "args": [
        { "op": "a_contains", "args": [{ "property": "current_landuse_group" }, ["Residential"]] },
        { "op": "=", "args": [{ "property": "construction_core_material" }, "Brick"] } ] } }
  ],
  "outputs": [{ "type": "number" }]
}
```

- `version`: the plan format's semantic version. A minor version only adds; the engine accepts every version
  it lists in the schema, today `"1.0.0"`.
- `area`: tagged by `type`. In 1.0.0 only `viewport`, with `bbox` `[west, south, east, north]` in WGS 84
  degrees (GeoJSON order), west < east and south < north, latitudes within Web Mercator's ±85.0511°. A view
  that crosses the 180° meridian is not supported. A building is in the view when its point on surface is
  inside it or on its edge (ADR-0005).
- `steps`: tagged by `type`, applied in order; in 1.0.0 only `filter`. Several filter steps all apply (AND).
  No steps means every building in the area.
- `filter`: the CQL2-JSON subset of ADR-0003, with these restrictions so each condition names one field:
  - comparisons `=`, `<>`, `<`, `<=`, `>`, `>=`: `[{"property": f}, value]`, field first;
  - `between`: `[{"property": f}, low, high]`, inclusive, numbers only;
  - `in`: `[{"property": f}, [values...]]`, at least one value;
  - `a_equals`, `a_contains`, `a_containedBy`, `a_overlaps`: `[{"property": f}, [values...]]`, for
    multi-valued fields, with CQL2's set meanings;
  - `recorded`, `blank`: `[{"property": f}]`;
  - `and`, `or` (two or more conditions), `not` (one).
  - Values are text, numbers or `true`/`false`. A field is a catalogue key. No property-to-property
    comparisons, no `like`, no `isNull`, no arithmetic, spatial or temporal operators.
- `outputs`: tagged by `type`, at least one; in 1.0.0 only `number`.
- Every object rejects members the schema does not list, so a misspelt member fails instead of being
  ignored.

**Meaning.** Conditions use CQL2's three-valued logic over the field's *normalised* value: blank (SQL null,
empty text, an empty array) is unknown, so `not`, `<>` and `or` never turn a blank into a match. `recorded`
is "not blank" and `blank` is "blank" by these rules until the host's missing-value metadata adds explicit
unknowns and defaults (ADR-0002). `recorded` and `blank` are never unknown, so a field they alone test does not
count towards the answer's recorded count; the fields whose values a condition compares do.

Conditions nest at most 20 levels (and/or/not), far beyond what a person writes, so a deliberately deep plan
is refused with a message instead of exhausting the validator's or the database's stack.

**Validation**, before anything runs: the JSON Schema decides the shape; the engine's validator then checks
the plan against the catalogue (field exists, value in its allowed list and of its type, operator fits the
field's type and multi-valuedness, ranges ordered) and writes each problem as a sentence naming the step and
the field's title.

## Alternatives considered

| Alternative | What it would have meant | Why not |
|---|---|---|
| CQL2 in either operand order | `5 < {"property": "x"}` allowed | Twice the cases for the validator and messages, nothing a builder or the assistant needs |
| Area as the first step | `steps[0]` is `{"type": "area"}` | ADR-0003 has exactly one area; a separate member makes "every plan has one area" a schema rule |
| Ordered `a_equals` | Arrays equal element by element | CQL2 defines set equality; the order of land uses is not meaningful in colouring-core |
| Treat `''` and `[]` as recorded | Plain SQL null only | `NOT (x = 'a')` would count an empty value as a match |
| Bbox as an object `{west, ...}` | Named edges | GeoJSON's order is what map libraries return and what other tools expect |

## Consequences

- Districts, drawn shapes, buffers, grouping and the other outputs arrive as new `type` values: minor
  versions, each with its decision record where ADR-0003 asks for one.
- A plan is plain JSON: a builder can construct it, the assistant can be constrained to the schema, and a
  shared link can carry it.
- Field keys are column names (ADR-0009).

## Plain-English summary

A question is written as a small JSON document: which part of the map, which conditions on building details,
and what answer is wanted. The conditions use the international CQL2 filter format, restricted so each
condition is about one detail. A detail that was never filled in never counts as a match by accident.
