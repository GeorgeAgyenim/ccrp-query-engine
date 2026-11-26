# ADR-0012: To count buildings in an area, first list the building outlines in the area, then look up their buildings

- Status: Proposed
- Date: 2026-11-26
- Origin: new in the engine repository (query-engine ticket 19)
- Deciders: proposed by Claude (Anthropic) as engineer; to be accepted by the product owner
- Related: ADR-0005 (how a building is placed in an area, unchanged; this record revises its note on growth to
  ten times the data), ADR-0001 (questions are answered by the platform's own database), ADR-0007 (the engine
  adds nothing to the platform's own tables)

## Summary

A question about every building on the map could take several seconds instead of a fraction of one. The cause
was the order in which the database was asked to do the work. The engine now asks for it in two steps, and the
same question takes under a tenth of a second, with the same answers. Nothing changes in the platform's
database.

## Context

A colouring-core platform keeps each building in two linked parts, joined by a number (`geometry_id`):

- its **outline** on the map (its "footprint"), in the `geometries` table;
- its **record**, everything contributors have filled in (land use, year, condition ...), in the `buildings`
  table.

To count the buildings in an area that meet some conditions, the engine needs both: the outline to decide
whether the building is in the area (by one point that always lies on the outline, ADR-0005), and the record
to check the conditions.

The engine sends the database (PostgreSQL with PostGIS) one query, and the database decides how to carry it
out. To choose, it estimates how many rows each step will produce, from statistics it keeps about each column.
It keeps none about "the point on a building's outline", so for the question "which outlines are in this
area?" PostGIS falls back to a fixed guess: about 1 in 10,000. For an area holding 20,000 outlines it expects
two.

The engine used to ask for both parts at once: "match each record to its outline, and keep those whose outline
is in the area". Expecting two outlines, the database could choose to take each record and search the outlines
for its partner one by one, which is quick for two outlines but means about 200 million comparisons for 20,000.

Whether it chose that slow way depended on small differences in its own cost figures, so the same question
could be fast on one database and slow on another. On the first platform to use the engine, a whole-map
question with two conditions missed its 2 s target by seconds; the same map with no conditions was fast.
The engine's own test map of 20,000 made-up buildings (`test/fixtures/many-buildings.sql`) shows the same:

| Test map, all of it in view, two conditions | Old way | This decision |
|---|---|---|
| Through the engine, before the database has gathered its statistics (`test/run-time.test.ts`) | inside 2 s | under 0.1 s |
| Through the engine, after the database has gathered them (`ANALYZE`; same test) | 3.9 s | under 0.1 s |
| The test map at ten times the size (200,000 buildings), database time only | 0.30 to 0.34 s | 0.34 to 0.37 s |

Finding the point on each outline was never the slow part: the time went on matching records to outlines.

How the last row was measured: the test map's outlines, numbers and two filled-in fields in plain tables with
colouring-core's two indexes, on the disposable test database (PostgreSQL 18, PostGIS 3.6.4) on the
developer's laptop, timed with `EXPLAIN (ANALYZE, TIMING OFF)` three times each, 26 November 2026.

## Decision

The engine's query now works in two steps:

1. **List the outlines in the area**, using the outlines alone. This step is marked `MATERIALIZED`, which tells
   the database to finish it on its own instead of merging it back into the next step
   (`footprints_in_view` in `src/compiler.ts`).
2. **Look up the record for each listed outline** by its number (`buildings.geometry_id`).

How a building is placed in an area, and every count, are unchanged.

Step 2 is fast whatever the database guessed in step 1. If it expects few outlines, it looks each record up in
the index colouring-core keeps on `buildings.geometry_id` (migration 002), like finding a page from a book's
index. If it expects many, it matches the whole list in one pass (a "hash join"). Either way the time grows in
step with the number of buildings in the area. Later kinds of question (grouping, distance) start from the same
list.

`test/run-time.test.ts` asks a question about the whole 20,000-building test map, before and after the database
gathers its statistics, and requires an answer within 2 s with the counts worked out by hand. After the
statistics were gathered, the old query failed it.

## Alternatives considered

| Alternative | What it would have meant | Why not |
|---|---|---|
| Give the database statistics about the point on each outline (`CREATE STATISTICS ... ON (ST_PointOnSurface(geometry_geom))`, PostgreSQL 14 and later) | The query stays as it was, and the guess becomes right (it did, on a copy) | Every platform's database owner would have to add it and refresh the statistics. The engine would be adding objects to a platform's own table, against ADR-0007. A platform that skipped the step would get slow answers with no warning |
| An index on the point on each outline | The guess becomes right, and small areas get an index (it worked on a copy) | The same owner and platform-table problems, plus extra work every time someone edits an outline. Small areas are already fast through the outlines' own index |
| Store the point on each outline in a new column, with an index (ADR-0005's note for ten times the data) | No calculation per question | Changes a platform's table, which is hard to undo, and the calculation was not where the time went |
| Match records to outlines by the outlines' bounding boxes first, then apply the exact test (`MATERIALIZED` candidates) | The database estimates the match from statistics it does keep. As fast as this decision on every copy tried (0.29 to 0.31 s at ten times the size) | Matching records to outlines still rests on a guess, and a wrong guess there is exactly what went wrong; it holds only while the platform's statistics are up to date. It also carries every requested field through the first step, not just one number per building |
| Tell the database never to use one-by-one searching for these questions (`SET LOCAL enable_nestloop = off`) | A blanket override of the database's choices | One-by-one searching through an index is the right way for small areas, and later questions (which district is each building in?) need it |

## Consequences

- Whole-map questions no longer take seconds, and no platform has to change its database. On the first
  platform, the whole-map question now meets its 2 s target with the same counts (its own benchmark record,
  26 November 2026).
- The fast way does not depend on colouring-core's index on `buildings.geometry_id`: with the index removed
  from a copy of the test map, the database matched the list in one pass (63 ms). It uses the index when there
  is one.
- At ten times the data the answer stays well inside 2 s (last row above), and time grows with the buildings in
  the area. This revises ADR-0005's note that "at 10x data it becomes a stored, indexed column": storing the
  point stays the fallback for areas of millions of buildings, not something ten times the data needs.
- For whole-map questions PostgreSQL also compiles the query to machine code first (its "JIT"), because PostGIS
  marks its functions as costly. This adds a few hundredths of a second. Not acted on: those answers are far
  inside their target.
- Step 1 holds one number per building in the area (under 1 MB for 20,000).
- Nothing changes in the plan format, the API, the database layout or any platform's data. Undoing this means
  changing the query back.

## Plain-English summary

To count buildings in an area, the engine now first lists which building outlines fall in the area, then
looks up those buildings' details by their outline's number. Before, it asked the database to do both at once.
The database cannot know in advance how many outlines fall in an area, sometimes guessed "two", and then
checked every building against the outlines one by one. On a test map of 20,000 buildings a whole-map
question took about four seconds; it now takes under a tenth of a second, with the same answers, and nothing
in the platform's database has to change.
