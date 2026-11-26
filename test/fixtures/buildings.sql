-- Fixture "buildings": hand-made synthetic buildings and footprints.
-- Made-up squares a few metres from 0°N 0°E (open sea), in EPSG:3857 like core's
-- footprints. No real building, place or instance is represented.
-- Ids start at 900001 so they cannot collide with rows core's own migrations insert.

INSERT INTO geometries (geometry_id, source_id, geometry_geom) VALUES
    (900001, 'fixture', ST_GeomFromText('POLYGON((0 0, 10 0, 10 10, 0 10, 0 0))', 3857)),
    (900002, 'fixture', ST_GeomFromText('POLYGON((20 0, 30 0, 30 10, 20 10, 20 0))', 3857));

INSERT INTO buildings (building_id, geometry_id) VALUES
    (900001, 900001),
    (900002, 900002);
