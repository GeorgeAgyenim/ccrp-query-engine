# CONTEXT.md: the engine's terms

The canonical vocabulary for this repository's code, tests, API and docs. Keep entries short; reasons belong in
[`docs/decisions/`](docs/decisions/README.md). The terms were adapted from the glossary of the engine's first
host, keeping only those the engine itself uses.

## Standing constraints

- Every answer carries its denominators and completeness.
- Every answer carries its "as of" time.
- One plan format: the builder and the assistant both produce it; only the compiler turns it into SQL.
- The assistant declines what the engine cannot do, and offers the dataset instead.
- The engine names no instance; instance facts arrive as configuration and data.
- The engine reads only buildings, footprints and its own tables, read-only, with a time limit.

## Terms

| Term | Meaning |
|---|---|
| Aggregate | Totting up buildings by a grouping (by area, by material) to get counts, shares or summaries. |
| Applicable population | The buildings in the spatial population to which a queried attribute applies; the base for completeness when an attribute does not apply to every building. |
| As of | The date and time of the data an answer was computed from: the transaction time on the live database, or the recorded snapshot time of a database copy. Shown on every answer. |
| Assistant | The entry route where a typed question, or a follow-up to the previous one, is turned into a plan by a language model. *Avoid*: chatbot, agent. |
| Attribute | A piece of information recorded about a building, such as its number of storeys, material or condition. |
| Buffer | A zone of a chosen distance around a point, line or shape. |
| Builder | A host UI's click-and-choose interface for composing a plan without writing code; the engine validates its plans. |
| Catalogue guard | The `check` command's test that every building column is in the field catalogue or on its exclusion list, run in each host's CI. |
| Clarification | The engine's answer when a request is ambiguous: a question with a fixed set of options (shown by the UI as chips), for an area, a distance or an attribute value. Never a guess. |
| colouring-core | The shared codebase every Colouring Cities platform is a fork of. Its `buildings` and `geometries` tables are the layout the engine reads. |
| Compiler | The component that turns a resolved plan into parameterised PostGIS SQL. The only path from plan to SQL. |
| Completeness | How many buildings in scope have a value recorded against how many do not, for one attribute or jointly for all the attributes a plan uses. A default counts as recorded only where field evidence shows it was observed. *Avoid*: coverage. |
| Component test | An evaluation run with one part of the engine changed (validation off, or the correct map reference injected) to see what that part contributes. Only server configuration can enable it. |
| Confirmed matches | The buildings for which a plan's whole filter is TRUE under three-valued logic: a blank never makes a condition true. With "or", a building can match while another queried attribute is blank; the share counts only the matches among recorded buildings. Zero confirmed matches with incomplete data is not evidence that no such buildings exist. |
| CQL2 | OGC's Common Query Language (standard 21-065r2). The plan's attribute filters use a subset of its JSON encoding. |
| Cross-tab | A table counting buildings by two attributes at once. |
| Database copy | A database an evaluation queries instead of the live one: a frozen snapshot, a patched copy (gaps filled with flagged synthetic values) or a masked copy (known values removed at a set rate). |
| Denominator | The total an answer is measured against: "out of how many". |
| Drawn shape | An area, point or line a person draws on the map for a query, named Area A, Area B and so on; stored in the plan so the analysis can be re-run. |
| Engine | This service: it validates, resolves, compiles and runs plans, and assembles answers. |
| Engine login | The database login a host creates for the engine and grants the engine role. The service refuses to start with any login that can see or change more. |
| Engine repo | This public repository (`GeorgeAgyenim/ccrp-query-engine`, GPL-3.0). It holds everything any instance can reuse unchanged. |
| Engine role | `query_engine_reader`: the no-login group role, created by the engine's migrations, that can SELECT the host's buildings and geometries and the engine's own tables, and nothing else. |
| Engine schema | `query_engine`: the database schema holding the engine's own tables, created by its migrations. |
| Entry route | A way of producing a plan: the builder or the assistant. |
| Evaluation mode | A server setting, off by default, that accepts component-test inputs and logs each request in full for research. Off, those inputs are rejected and logs hold no question text or location. |
| Exclusion list | The catalogue's `excludedColumns`: building columns the engine does not query, each with its reason (no definition, a type plan format 1 cannot compare, nested values). |
| Executor | The component that runs SQL: one read-only transaction per run, with the statement timeout set inside it. The engine's only path to the database. |
| Field catalogue | The versioned file listing every field a host defines (category, title, type, allowed values), generated from the host's own field definitions. With the missing-value metadata, it is what the engine knows about attributes. |
| Footprint | The outline of a building as seen from above, stored in colouring-core's `geometries` table in EPSG:3857. |
| Grounding | The reference material (field catalogue, layer list) the assistant is given so its plans fit the platform. |
| Host | A CCRP instance that runs the engine next to its own platform. *Avoid*: client. |
| Host contract | What a host supplies: a database with colouring-core's building and footprint tables, an engine login, a field catalogue, missing-value metadata, footprint provenance, a model URL, a proxy route and its own UI. |
| Language model (LLM) | The AI software behind the assistant, reached through one OpenAI-compatible URL. |
| Layer | A set of map shapes with information attached (district outlines, flood zones). |
| Map reference | The one thing on the map a request's area is bound to: an administrative area, the viewport, the selected building or a drawn shape. |
| Map state | What the map holds when a request is made: the viewport, the selected building, the boundary layers switched on and any drawn shapes. |
| Missing value | A queried attribute with no usable recorded value. Kinds: blank, explicit unknown, inapplicable, and placeholder or default. |
| Missing-value metadata | A host's per-field file saying, with evidence, which values count as missing, plus unit, range, multi-valued and applicability. |
| Non-conforming value | A recorded value outside the field's allowed list. Reported as such, never merged or dropped. |
| Open-weight model | A language model whose trained parameters are published, so it can run on one's own computer. |
| Plan | The structured description of a question: one area, ordered steps and outputs, in versioned JSON. *Unresolved* plans may name map references; *resolved* plans hold concrete values and are the only ones that compile. |
| Point on surface | The one point guaranteed to lie on a footprint (PostGIS `ST_PointOnSurface`) that decides which area a building is in. |
| PostGIS | The extension that gives PostgreSQL geographic abilities; the engine's compile target. |
| Provenance | The recorded origin of a dataset: source, licence, date, processing, limitations. |
| Recorded count | The buildings in the applicable population with every queried attribute recorded (an attribute tested only for being recorded or blank does not count: that test is never unknown); the denominator for shares among recorded buildings. |
| Reference layer | A layer the engine provides for everyone, such as district boundaries, loaded as data with its provenance. |
| Resolving | Deciding which map reference a request's wording means; when several are eligible, returning a clarification instead of guessing. |
| Snapshot | A copy of the data taken at a known, recorded moment. |
| Spatial population | All mapped buildings assigned to a map reference, recorded or not. |
| Spatial relate | Asking which buildings fall inside, touch, or are near some other shapes. |
| Start-up check | What the service verifies before serving: colouring-core's layout, the engine's migrations current, and a login restricted to the engine role. Any problem stops it with a plain message. |
| Statement timeout | The longest one SQL statement may run before PostgreSQL cancels it; set by the executor in every transaction (default 10 s). |
| Structured output | Making a language model answer in a fixed format (a JSON plan) rather than free text. |
| Undefined | A share or average whose denominator is zero. Shown as undefined, with the reason, never as 0%. |
| Validator | The component that checks a plan against its schema, the field catalogue and the layer registry before it runs, with plain-English errors. |
| Viewport | The part of the map currently visible; as a map reference, the area meant by "in this view". |
