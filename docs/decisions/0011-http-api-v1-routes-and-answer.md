# ADR-0011: HTTP API version 1: four routes, a status-tagged answer, and one templated sentence

- Status: Accepted 2026-11-26 (one-way door: every host UI calls these routes and reads these payloads)
- Date: 2026-11-26
- Origin: new in the engine repository (query-engine ticket 02); makes ADR-0006's API concrete
- Deciders: proposed by Claude (Anthropic) as engineer; accepted by the product owner 2026-11-26
- Related: ADR-0006 (separate service), ADR-0008 (logs), ADR-0009 (catalogue), ADR-0010 (plan format)

## Context

The engine's API is reached through a host's `/api/query/*` proxy route (ADR-0006). A host UI needs the fields
to offer, the plan schema, a way to check a plan while it is built, and a way to run it. Later tickets add
ask, download, layers and clarifications, so routes and payloads must grow by addition. Every answer must
carry its denominators, its completeness and its "as of" time in one sentence of the form "As of <time> — of
<N> mapped buildings in this view, <fields> are recorded for <R>; <M> are recorded as <condition>" (FR-5.5).

## Decision

**Routes**, versioned in the path; JSON in and out, described by `schemas/api-1.schema.json`:

| Route | Body | Responses |
|---|---|---|
| `GET /v1/catalogue` | none | 200 the catalogue's categories, each with its fields |
| `GET /v1/plan-schema` | none | 200 the plan JSON Schema this engine runs |
| `POST /v1/validate` | `{"plan": ...}` | 200 `{"status": "valid"}` or `{"status": "invalid", "errors": [...]}` |
| `POST /v1/run` | `{"plan": ...}` | 200 `{"status": "answer", ...}`; 422 `{"status": "invalid", "errors": [...]}` |

- The request wraps the plan, so later members (the map state) are additions.
- `status` tags every validate and run body; later outcomes (`clarification`) are new tags.
- A plan problem is `{"message", "step", "field", "path"}`: a sentence naming the step and the field's title,
  the 1-based step number or `null`, the field key or `null`, and a JSON Pointer into the plan.
- A malformed request (not JSON, not an object with `plan`) is 400 `{"error": ...}`. A statement timeout or an
  unreachable database is 503 `{"error": ...}`. A number beyond the range of the column it is compared with
  (numbers are compared in the column's own type) is 422 `invalid`. Anything else is 500
  `{"error": "internal error"}`.

**The answer** (`status: "answer"`):

- `asOf`: the run's transaction time, ISO 8601 in UTC;
- `plan`: the plan as run;
- `spatialPopulation`: mapped buildings in the area;
- `recordedCount`: those with every field recorded whose values a condition compares (a field tested only by
  `recorded` or `blank` needs nothing recorded: those tests are never unknown);
- `confirmedMatches`: those for which the whole filter is TRUE under three-valued logic. With `or`, a building
  can match while another compared field is blank, so this can exceed the share's numerator;
- `share`: `{numerator, denominator, value, isUndefined, undefinedReason}`: confirmed matches among
  recorded buildings over the recorded count; when the recorded count is zero, `value` is `null`,
  `isUndefined` is true and `undefinedReason` says why, never 0%;
- `fields`: each queried field's key, title and ambiguity note, in order of first use;
- `sentence`: one sentence from fixed templates, never from a language model:
  `As of 26 Nov 2026 16:01 UTC — of 9 mapped buildings in this view, Land use and Main material are both
  recorded for 6; 1 is recorded as matching Land use includes "Residential" and Main material is "Brick".`
  (the engine's test fixtures). Zero is worded `there are zero confirmed matches for ...`; one field is `is recorded
  for`, two `are both`, more `are all`; when some matches have a compared field blank, the sentence adds
  `, 3 of them among those 6`; a plan of only `recorded`/`blank` tests reads `of 9 mapped buildings in this
  view, 2 meet the condition Land use is blank`; times are UTC and say so.

Exposure is the host's: the engine has no authentication and serves only what its login can read
(host setup guide).

## Alternatives considered

| Alternative | What it would have meant | Why not |
|---|---|---|
| 200 for an invalid run | One status code for every run outcome | Nothing ran; a 4xx lets proxies and monitoring tell a rejected plan from an answer |
| 400 for an invalid run | The usual "bad request" | The request was well-formed JSON; 422 says its content was refused |
| The plan as the whole body | `POST /v1/run` with the plan alone | The map state and evaluation inputs would need a breaking change |
| Error codes beside messages | `{"code": "unknown_field", ...}` | A second vocabulary to freeze before any UI needs it; can be added later without breaking |
| Local time in the sentence | Format "as of" in the host's zone | A new setting; UTC labelled as such is never ambiguous, and `asOf` lets a UI show local time |
| Share as a bare number | `0.43` or `null` | The denominator and the reason for undefined must travel with it |

## Consequences

- The first host's UI and its tests build on these payloads; the generated TypeScript types and the API
  reference's examples are their contract.
- Adding routes, members or `status` values is a minor change; removing or renaming one needs `/v2`.
- The sentence is English only.

## Plain-English summary

The engine offers four web addresses: one lists the building details people can ask about, one describes the
question format, one checks a question without running it, and one answers it. Every answer gives the time of
the data, how many buildings were in view, how many had the details recorded, how many matched, and one plain
sentence saying all of that.
