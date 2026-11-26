# ADR-0004: Reference layers are stored in PostGIS in one layer catalogue and one feature table, loaded as data

- Status: Accepted (one-way door: database schema)
- Date: 2026-11-26
- Ported from: Colouring Ghana ADR-0015, as amended by its ADR-0017 (both 2026-11-26; not public)
- Deciders: proposed by Claude (Anthropic) as engineer; accepted by the first host's product owner
- Related: ADR-0001 (server engine), ADR-0006 (the engine owns its tables), ADR-0007 (engine schema)

## Context

In a colouring-core instance, area outlines such as administrative districts often exist only as static
GeoJSON files the map draws, sometimes without codes. A server-side engine (ADR-0001) cannot query a file.
Other layers, such as flood zones or finer boundaries, are expected later as data. Each layer needs a
provenance record and an "as of" date.

## Decision

The engine's own schema (ADR-0007) gets two tables, created by the engine's migrations:
- a **layer catalogue**: key, display name, kind (boundary or zone), source, licence, as-of date, a link to
  its provenance record, and its coverage extent;
- a **feature table**: layer key, stable feature key, name, other properties as JSON, and geometry in the
  buildings' projection (EPSG:3857), with a spatial index.

One loader, the engine's `load-layer` command, adds or replaces a whole layer in a single transaction, from a
GeoJSON file plus its provenance record. A host loads its boundaries from the same file its map draws, so
the engine and the map agree. The engine's role can read both tables.

## Alternatives considered

| Alternative | What it would have meant | Why not |
|---|---|---|
| One table per layer | A migration for each new layer | New layers would need code, contradicting "drop in as data" |
| Keep boundaries as files only | The engine reads the GeoJSON in Node | Two spatial engines (Node and PostGIS) that must agree |
| An external map server | GeoServer or similar | Another service to run and secure |

## Consequences

- A host's map can keep drawing its boundaries from its file. A later change can serve them from these
  tables.
- A layer that covers only part of an area has a recorded extent, so buildings outside it are counted
  separately, never reported as "outside the zone".
- Replacing a layer changes answers. Its as-of date is part of every answer that uses it.

## Plain-English summary

Area outlines such as districts, and later flood zones or electoral areas, are kept in the database in one
standard shape. A new layer is added by loading a file and its source record, with no programming. Each answer
says which layers it used and how up to date they are.
