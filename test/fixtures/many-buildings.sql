-- Fixture "many-buildings": 20,000 hand-made synthetic buildings in a regular grid, for timing a run
-- over a city's worth of buildings (test/run-time.test.ts; query-engine ticket 19). Made-up squares
-- near 0°N 0°E (open sea), in EPSG:3857; no real building, place or instance is represented.
-- Loaded into its own copy of the database, never the main test database, so the other tests'
-- counts are unchanged. Read with test/fixtures/catalogue.json.
--
-- Column i = 0..199, row j = 0..99. Building (i, j) is the 4 m square from x = 10i + 3 to 10i + 7 and
-- y = 10j + 3 to 10j + 7 (metres), so the grid spans x 3 to 1997 m and y 3 to 997 m. Its point on
-- surface is the square's centre (10i + 5, 10j + 5). Ids: 1,000,000 + 200j + i.
--
--  date_year                    2000 in even columns, 1990 in odd ones: recorded for all 20,000
--  construction_core_material   Brick in rows 0 to 49, blank above: recorded for 200 × 50 = 10,000
--
-- So a plan asking for a year from 2000 on and Brick matches the even columns of rows 0 to 49:
-- 100 × 50 = 5,000 buildings, all of them among the 10,000 with both fields recorded.
--
-- PostgreSQL's background maintenance (autovacuum) is switched off on both tables, so that it does
-- not gather statistics on them while the tests run; the test gathers them itself (ANALYZE) when it
-- wants them.

ALTER TABLE geometries SET (autovacuum_enabled = false);
ALTER TABLE buildings SET (autovacuum_enabled = false);

INSERT INTO geometries (geometry_id, source_id, geometry_geom)
SELECT 1000000 + 200 * j + i, 'fixture', ST_MakeEnvelope(10 * i + 3, 10 * j + 3, 10 * i + 7, 10 * j + 7, 3857)
  FROM generate_series(0, 199) AS i, generate_series(0, 99) AS j;

INSERT INTO buildings (building_id, geometry_id, date_year)
SELECT 1000000 + 200 * j + i, 1000000 + 200 * j + i, CASE WHEN i % 2 = 0 THEN 2000 ELSE 1990 END
  FROM generate_series(0, 199) AS i, generate_series(0, 99) AS j;

-- A literal, so it takes the column's own type.
UPDATE buildings SET construction_core_material = 'Brick' WHERE building_id - 1000000 < 200 * 50;
