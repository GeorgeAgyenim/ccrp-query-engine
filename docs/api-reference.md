# API reference

The engine's HTTP API. A host's UI reaches it through the host's reverse-proxy route `/api/query/*`, which
forwards to the engine with that prefix removed ([host setup](host-setup.md#reverse-proxy)), so
`GET /api/query/v1/catalogue` on the host is `GET /v1/catalogue` on the engine. Paths below are the engine's
own. Decided in [ADR-0011](decisions/0011-http-api-v1-routes-and-answer.md) (proposed); the plan format in
[ADR-0010](decisions/0010-plan-format-1-json-shape.md) (proposed).

Status: pre-release, API version 1. A plan's area is the current view; its steps are filters; its output is a
number.

| Route | Does |
|---|---|
| [`GET /health`](#get-health) | Whether the service runs and reaches its database |
| [`GET /v1/catalogue`](#get-v1catalogue) | The fields a plan can query, by category |
| [`GET /v1/plan-schema`](#get-v1plan-schema) | The plan JSON Schema this engine runs |
| [`POST /v1/validate`](#post-v1validate) | Checks a plan without running it |
| [`POST /v1/run`](#post-v1run) | Runs a plan and returns the answer |

## Conventions

- Requests and responses are JSON (`application/json`, UTF-8). Request bodies are at most 1 MiB.
- Query routes are versioned in the path (`/v1/...`). Version 1 grows only by addition: new routes, new
  members, new `status` values. Operational routes such as `/health` are not versioned.
- Every body is described by the published JSON Schemas in [`schemas/`](../schemas): the plan
  (`plan-1.schema.json`), the field catalogue (`catalogue-1.schema.json`) and the API's bodies
  (`api-1.schema.json`). [`schemas/query-engine.d.ts`](../schemas/query-engine.d.ts) holds the same as
  TypeScript types, for a host's UI to copy; regenerate it with `npm run types` after changing a schema.
- Errors that are not about a plan have the body `{"error": "<plain-English message>"}`: 400 for a malformed
  request, 404 for an unknown route, 503 when the database is not answering or a question took longer than
  the statement timeout, 500 (`internal error`) for anything else, whose details go to the engine's log
  without any value a request sent.
- The engine keeps no session and no state between requests. It has no authentication: the host's proxy
  decides who can reach it ([host setup](host-setup.md#reverse-proxy)).
- A request's log line records its method, route pattern, status and duration, never the query string, body,
  headers or client address. Plans and their problems are not logged.

The examples below come from the engine's test fixtures: made-up buildings near 0°N 0°E, and the fixture
catalogue in `test/fixtures/catalogue.json`.

## `GET /health`

Whether the service is running and can query its database. For container health checks, monitoring and the
host's proxy.

| Status | Body | Meaning |
|---|---|---|
| 200 | `{"status":"ok"}` | The service answered and its database ran a query |
| 503 | `{"status":"unavailable"}` | The service is running but its database did not answer |

```sh
curl -i http://127.0.0.1:3100/health
# HTTP/1.1 200 OK
# content-type: application/json; charset=utf-8
#
# {"status":"ok"}
```

A 503 is logged with the error's name and database error code. The service keeps running and answers 200 again
when the database is back.

## `GET /v1/catalogue`

The fields a plan can query, grouped by the host's categories in its display order, each with its type and
allowed values. The allowed values come from the host's field definitions, so they include values nobody has
recorded yet. The list is the host's field catalogue file ([host setup](host-setup.md#the-field-catalogue)).

| Member | Meaning |
|---|---|
| `formatVersion` | The catalogue format, `"1.0.0"` |
| `categories[]` | `key`, `title` and `fields`, in the host's order; a category may have no fields |
| `fields[].key` | The field's key: what a plan names in `{"property": ...}` (the buildings column) |
| `fields[].type` | `text`, `integer`, `number` or `boolean` |
| `fields[].multiValued` | The field holds a list of values (use the `a_...` conditions) |
| `fields[].allowedValues` | The values a condition may use, or `null` for any value of the type |
| `fields[].ambiguity` | Why a recorded value may not be an observation, or `null` |

```sh
curl http://127.0.0.1:3100/v1/catalogue
```

```json
{
  "formatVersion": "1.0.0",
  "categories": [
    {
      "key": "land-use",
      "title": "Land use",
      "fields": [
        {
          "key": "current_landuse_group",
          "category": "land-use",
          "title": "Land use",
          "type": "text",
          "multiValued": true,
          "allowedValues": ["Residential", "Retail", "Industry", "Agriculture"],
          "ambiguity": null
        }
      ]
    },
    {
      "key": "construction",
      "title": "Construction",
      "fields": [
        {
          "key": "size_storeys_core",
          "category": "construction",
          "title": "Number of storeys",
          "type": "integer",
          "multiValued": false,
          "allowedValues": null,
          "ambiguity": "The database stores 0 when nothing is entered, so a recorded 0 may not be an observation."
        }
      ]
    }
  ]
}
```

(Shortened: the fixture catalogue has five categories and six fields.)

## `GET /v1/plan-schema`

The plan format's JSON Schema (2020-12) for the version this engine runs: the contents of
`schemas/plan-1.schema.json`, whose `$id` is `urn:ccrp-query-engine:schema:plan:1.0.0`. A builder or the
assistant can constrain itself to it. No body; always 200.

```sh
curl http://127.0.0.1:3100/v1/plan-schema
```

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:ccrp-query-engine:schema:plan:1.0.0",
  "title": "Plan",
  "type": "object",
  "required": ["version", "area", "steps", "outputs"],
  "additionalProperties": false,
  "properties": {
    "version": { "description": "The plan format's semantic version.", "enum": ["1.0.0"] },
    "area": { "$ref": "#/$defs/Area" },
    "steps": { "type": "array", "items": { "$ref": "#/$defs/Step" } },
    "outputs": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/Output" } }
  },
  "$defs": { "...": "the area, step, condition and output definitions" }
}
```

(Shortened: descriptions and `$defs` are left out here.)

### The plan, format 1.0.0

```json
{
  "version": "1.0.0",
  "area": { "type": "viewport", "bbox": [0, 0.0009, 0.0009, 0.0018] },
  "steps": [
    {
      "type": "filter",
      "filter": {
        "op": "and",
        "args": [
          { "op": "a_contains", "args": [{ "property": "current_landuse_group" }, ["Residential"]] },
          { "op": "=", "args": [{ "property": "construction_core_material" }, "Brick"] }
        ]
      }
    }
  ],
  "outputs": [{ "type": "number" }]
}
```

- `area`: the current view, `bbox` `[west, south, east, north]` in WGS 84 degrees, west < east and
  south < north, latitudes within ±85.0511°. A building is in the view when its point on surface is inside it
  or on its edge ([ADR-0005](decisions/0005-spatial-membership-and-distance-rules.md)).
- `steps`: filter steps, all applied; none means every building in the view.
- `outputs`: `[{"type": "number"}]`.
- A condition is CQL2-JSON ([OGC 21-065r2](https://docs.ogc.org/is/21-065r2/21-065r2.html)), restricted so the
  field comes first:

| Condition | `args` | For |
|---|---|---|
| `=`, `<>` | `[{"property": f}, value]` | single-valued fields |
| `<`, `<=`, `>`, `>=` | `[{"property": f}, number]` | numeric fields |
| `between` | `[{"property": f}, low, high]`, both ends included | numeric fields |
| `in` | `[{"property": f}, [value, ...]]` | single-valued text and numeric fields |
| `a_contains`, `a_overlaps`, `a_equals`, `a_containedBy` | `[{"property": f}, [value, ...]]`, compared as sets | multi-valued fields |
| `recorded`, `blank` | `[{"property": f}]` | any field |
| `and`, `or` | two or more conditions | |
| `not` | one condition | |

Blank means null, empty text or an empty list. A blank value is unknown: no comparison, `not` or `or` turns it
into a match on its own (CQL2's three-valued logic). Conditions nest at most 20 levels deep.

## `POST /v1/validate`

Checks a plan against the plan format and the field catalogue, without running anything. For a builder, to
stop a person building a plan that cannot run.

Body: `{"plan": <plan>}`.

| Status | Body |
|---|---|
| 200 | `{"status": "valid"}` |
| 200 | `{"status": "invalid", "errors": [<problem>, ...]}` |
| 400 | `{"error": ...}`: the body is not a JSON object with exactly one member, `plan` |

Each problem is a sentence a person can act on, naming the step and the field's title:

| Member | Meaning |
|---|---|
| `message` | The sentence |
| `step` | The step's number, from 1, or `null` for the area, outputs or the plan as a whole |
| `field` | The field's key, or `null` |
| `path` | A JSON Pointer to the part of the plan (`""` for the whole plan) |

```sh
curl -X POST http://127.0.0.1:3100/v1/validate -H 'content-type: application/json' -d '{"plan": {
  "version": "1.0.0",
  "area": {"type": "viewport", "bbox": [0, 0.0009, 0.0009, 0.0018]},
  "steps": [{"type": "filter", "filter": {"op": "and", "args": [
    {"op": "=", "args": [{"property": "current_landuse_group"}, "Residential"]},
    {"op": "=", "args": [{"property": "construction_core_material"}, "Granite"]}]}}],
  "outputs": [{"type": "number"}]}}'
```

```json
{
  "status": "invalid",
  "errors": [
    {
      "message": "Step 1: \"Land use\" can hold several values, so it needs a list condition (a_contains, a_overlaps, a_equals or a_containedBy), not \"=\".",
      "step": 1,
      "field": "current_landuse_group",
      "path": "/steps/0/filter/args/0/op"
    },
    {
      "message": "Step 1: \"Granite\" is not one of the values \"Main material\" can take: \"Wood\", \"Stone\", \"Brick\", \"Steel\" and \"Reinforced Concrete\".",
      "step": 1,
      "field": "construction_core_material",
      "path": "/steps/0/filter/args/1/args/1"
    }
  ]
}
```

The validator reports every problem it finds: a malformed plan, an unknown field, a value outside a field's
allowed list or of the wrong type, an operator that does not fit the field, a range given high-to-low.

## `POST /v1/run`

Validates the plan, then counts the buildings in one read-only transaction.

Body: `{"plan": <plan>}`.

| Status | Body |
|---|---|
| 200 | The answer, `{"status": "answer", ...}` |
| 422 | `{"status": "invalid", "errors": [...]}`, as from validate; nothing ran |
| 400 | `{"error": ...}`: the body is not a JSON object with exactly one member, `plan` |
| 422 | Also when a number is beyond the range of the field's column (numbers are compared in the column's own type) |
| 503 | `{"error": ...}`: the question took longer than the statement timeout, or the database is not answering |

The answer:

| Member | Meaning |
|---|---|
| `asOf` | The run's transaction time, ISO 8601 in UTC |
| `plan` | The plan as run |
| `spatialPopulation` | Mapped buildings in the view |
| `recordedCount` | Of those, the buildings with every field recorded whose values a condition compares. A field tested only by `recorded` or `blank` needs nothing recorded (those tests are never unknown); with only such tests, it is the spatial population |
| `confirmedMatches` | Of those in the view, the buildings for which the whole filter is TRUE. With `or`, a building can match while another of its queried fields is blank, so this can exceed the share's numerator |
| `share` | Confirmed matches among recorded buildings (`numerator`) over the recorded count (`denominator`), and `value`. When the recorded count is zero, `value` is `null`, `isUndefined` is `true` and `undefinedReason` says why: never 0% |
| `fields` | Each queried field's `key`, `title` and `ambiguity` note, in order of first use |
| `sentence` | The answer in one sentence, from fixed templates; times in UTC. When some confirmed matches have a compared field blank (with `or`), it adds how many are among the recorded buildings: `..., 4 are recorded as matching ..., 3 of them among those 6.` With only `recorded`/`blank` tests: `of 9 mapped buildings in this view, 2 meet the condition Land use is blank.` |

```sh
curl -X POST http://127.0.0.1:3100/v1/run -H 'content-type: application/json' -d '{"plan": {
  "version": "1.0.0",
  "area": {"type": "viewport", "bbox": [0, 0.0009, 0.0009, 0.0018]},
  "steps": [{"type": "filter", "filter": {"op": "and", "args": [
    {"op": "a_contains", "args": [{"property": "current_landuse_group"}, ["Residential"]]},
    {"op": "=", "args": [{"property": "construction_core_material"}, "Brick"]}]}}],
  "outputs": [{"type": "number"}]}}'
```

```json
{
  "status": "answer",
  "asOf": "2026-11-26T16:01:25.591Z",
  "plan": { "version": "1.0.0", "area": { "type": "viewport", "bbox": [0, 0.0009, 0.0009, 0.0018] }, "steps": ["..."], "outputs": [{ "type": "number" }] },
  "spatialPopulation": 9,
  "recordedCount": 6,
  "confirmedMatches": 1,
  "share": { "numerator": 1, "denominator": 6, "value": 0.16666666666666666, "isUndefined": false, "undefinedReason": null },
  "fields": [
    { "key": "current_landuse_group", "title": "Land use", "ambiguity": null },
    { "key": "construction_core_material", "title": "Main material", "ambiguity": null }
  ],
  "sentence": "As of 26 Nov 2026 16:01 UTC — of 9 mapped buildings in this view, Land use and Main material are both recorded for 6; 1 is recorded as matching Land use includes \"Residential\" and Main material is \"Brick\"."
}
```

(`plan` is shortened here; the engine returns it whole.)

A field nobody has recorded in the view gives an undefined share and zero confirmed matches, worded as such:

```json
{
  "spatialPopulation": 9,
  "recordedCount": 0,
  "confirmedMatches": 0,
  "share": {
    "numerator": 0,
    "denominator": 0,
    "value": null,
    "isUndefined": true,
    "undefinedReason": "No building in this view has Typology recorded, so the share among recorded buildings is undefined, not 0%."
  },
  "sentence": "As of 26 Nov 2026 16:01 UTC — of 9 mapped buildings in this view, Typology is recorded for none; there are zero confirmed matches for Typology is \"Low-rise\"."
}
```

(Members other than the counts are left out of this second example.)

## Planned

Each arrives with its own ticket and is documented here when it does: the reference-layer list; districts,
drawn shapes, the selected building and buffers as areas; grouping, ranking and comparison; the map, table,
chart and dataset outputs; *ask* (a question and the map state to a plan, a clarification or a decline); and
*download* (a zip of the full result as CSV with a metadata file).
