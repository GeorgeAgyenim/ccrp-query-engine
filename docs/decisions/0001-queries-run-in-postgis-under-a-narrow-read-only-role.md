# ADR-0001: Plans are compiled to PostGIS SQL and run on the server under a narrow read-only role

- Status: Accepted
- Date: 2026-11-26
- Ported from: Colouring Ghana ADR-0011, as amended by its ADR-0017 (both 2026-11-26; not public)
- Deciders: the first host's product owner, with Claude (Anthropic) as engineer
- Related: ADR-0003 (plan format), ADR-0006 (separate service), ADR-0007 (schema, role and migrations)

## Context

A question is written down as a *plan* (ADR-0003), and something has to run it. The two candidates were
the host platform's own PostGIS database on the server, and an analytical database running inside each
visitor's browser (DuckDB-WASM). The browser route serves uploaded layers that must stay private and offline
use; neither is in the first slice. It also needs a snapshot export job, snapshot hosting and a
multi-megabyte engine download on phones before the first answer. Every colouring-core instance already
runs PostgreSQL with PostGIS.

The research evaluation behind the engine needs frozen, patched and masked copies of a database, and a fair
comparison with a language model writing SQL directly. A PostGIS copy is just a database, and PostGIS is the
spatial SQL dialect language models know best.

A host's existing read-only database roles may be able to read contributor data: user accounts, sessions,
password-reset tokens and edit logs. They usually have no statement timeout either.

## Decision

- One compiler, targeting PostGIS. The server runs compiled plans. The plan format stays independent of any
  engine.
- The engine connects with its own login, granted the engine's no-login group role (ADR-0007). That role
  can read the host's buildings and footprints and the engine's own tables, and nothing else: no user,
  session, token or log tables.
- Every query runs in a read-only transaction, with a statement timeout set inside that transaction,
  whatever the login's own defaults are.
- Only compiler output is executed, and it uses a fixed allow-list of PostGIS functions.
- The database the engine queries is one setting, so a frozen or masked copy can be selected for
  evaluation.
- "As of" is the moment of execution on the live database, or the recorded snapshot time of a frozen copy.
- A device's location is never sent: "my location" is not a query anchor. The visible extent and any drawn
  shapes are sent to the server as part of the plan.

## Alternatives considered

| Alternative | What it would have meant | Why not |
|---|---|---|
| Browser engine now | Snapshot export, hosting and DuckDB-WASM before any answer | Several more pieces before the first answer, for needs (uploads, offline) outside the first slice |
| Both engines | Server now, browser for some cases | Two engines would have to agree exactly on every answer |
| Reuse a host's existing read-only role | No new role | Such roles can read contributor and session data and have no timeout |

## Consequences

- **Load target:** one demonstration user up to tens of concurrent users, on tens of thousands of
  buildings. A run answers within 2 s at the 95th percentile on a laptop, excluding the language model
  (measured in a later ticket).
- **What breaks first at 10x users:** the assistant's single local language model, not PostGIS. The escape
  hatch is a request queue with rate limits, and moving the model endpoint to a GPU host.
- **At 10x data:** plans stay scoped to an area and spatial (GiST) indexes carry them. The per-query
  point-on-surface (ADR-0005) becomes a stored, indexed column.
- **Escape hatch for the engine itself:** if uploads or offline use arrive, a browser engine replaces the
  server target behind the same plan format, compiler interface and validator. It replaces the server
  engine rather than running beside it.
- Creating the engine's role needs a migration run with database-owner rights in each environment
  (ADR-0007).
- The service refuses to start if its login can read or change more than the role allows (ADR-0007), so a
  misconfigured login cannot quietly undo this decision.

## Plain-English summary

Questions are answered by the platform's own database on the server rather than inside each visitor's
browser, because that is far quicker to build and suits the research tests. The engine gets its own
restricted login that can only see building and map data, never contributor accounts, and every query has a
time limit. The way questions are written down does not depend on this choice, so an in-browser engine could
take over later.
