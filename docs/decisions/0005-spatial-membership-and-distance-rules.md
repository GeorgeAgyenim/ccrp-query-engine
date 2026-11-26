# ADR-0005: A building is placed by one point on its footprint; distances are geodesic metres from the footprint edge

- Status: Accepted (fixes the meaning of every count; the research requires these rules fixed before testing)
- Date: 2026-11-26
- Ported from: Colouring Ghana ADR-0016 (2026-11-26; not public)
- Deciders: proposed by Claude (Anthropic) as engineer; accepted by the first host's product owner
- Related: ADR-0003 (plan format), ADR-0004 (reference layers)

## Context

colouring-core stores footprints in EPSG:3857 (Web Mercator), as polygons and a few multipolygons. Lengths
measured in EPSG:3857 are too long by a factor of 1 / cos(latitude): about 0.7% at 6.7° from the equator, 15%
at 30° and 61% at 51.5°. One UTM zone is metric, but each covers only 6° of longitude, so an instance whose
area crosses a zone boundary (the 0° meridian, for one) would be wrong on one side of it. Counts also need
explicit rules for footprints that cross an edge, buildings on a shared edge, overlapping polygons and
distance thresholds.

## Decision

- **Membership.** A building is in an area (an administrative area, the viewport, a drawn area, or "within" a
  zone) when one point guaranteed to lie on its footprint (PostGIS `ST_PointOnSurface`) is inside the area
  or on its edge.
- **Grouping by a boundary layer.** Each building goes to exactly one feature: of the features that contain
  its point, the one with the smallest feature key. Buildings in no feature form a reported "outside all
  areas" group. The answer reports how many buildings sat on a shared edge or in an overlap.
- **Intersects.** Any part of the footprint overlaps or touches the zone.
- **Not within.** Counted only among buildings inside the layer's coverage extent. Buildings outside the
  extent are reported separately.
- **Distance and buffer.** Metres on the WGS 84 spheroid (geodesic), measured from the nearest edge of the
  footprint to the reference: another footprint, a drawn point, line or area, or a layer feature. "Within D
  m" includes D.
- **Drawn areas compared side by side** are separate groups, so a building in two overlapping drawn areas
  counts in both, and the answer says so.

## Alternatives considered

| Alternative | What it would have meant | Why not |
|---|---|---|
| Centroid | The geometric centre decides membership | For an L- or U-shaped footprint it can fall outside the building |
| Any intersection for membership | A footprint touching two districts counts in both | Double counts; group totals exceed the population |
| Planar metres in EPSG:3857 | Use stored coordinates directly | Too long by 1 / cos(latitude): 0.7% near the equator, far more further from it |
| One UTM zone | One metric projection | Wrong outside the zone's 6° of longitude |

## Consequences

- Every rule has an independently hand-checked test case: a crossing footprint, a shared edge, an overlap,
  a concave footprint whose centroid falls outside it, and distances just inside and just outside a
  threshold.
- The point-on-surface is computed per query. At 10x data it becomes a stored, indexed column.

## Plain-English summary

To decide whether a building is in an area, the engine takes one point that is always inside the building's
outline and checks where that point falls. So every building is counted once, even when it straddles a line.
Distances are true distances in metres on the earth's surface, measured from the edge of the building rather
than its middle.
