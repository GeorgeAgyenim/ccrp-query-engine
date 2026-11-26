-- Fixture "count-in-view": hand-made synthetic buildings around one test view, for counting
-- buildings that match conditions. Made-up shapes a few metres from 0°N 0°E (open sea), in
-- EPSG:3857; no real building, place or instance is represented. Read with
-- test/fixtures/catalogue.json.
--
-- The test view is bbox [0, 0.0009, 0.0009, 0.0018] (WGS 84). In EPSG:3857 that is
-- x 0 to 100.1875 m and y 100.1875 to 200.3751 m (x = 6378137 m × longitude in radians).
-- A building is in the view when its point on surface (ST_PointOnSurface) is inside or on the
-- edge. For a rectangle that point is its centre; for the U shapes it is in the U's solid
-- side (worked out below).
--
--  id      footprint (x, y in metres)        point on surface  in view?
--  900101  10..20,   110..120                 (15, 115)         yes
--  900102  30..40,   110..120                 (35, 115)         yes
--  900103  50..60,   110..120                 (55, 115)         yes
--  900104  70..80,   110..120                 (75, 115)         yes
--  900105  10..20,   140..150                 (15, 145)         yes
--  900106  30..40,   140..150                 (35, 145)         yes
--  900107  10..20,   300..310                 (15, 305)         no: north of the view
--  900108  150..160, 110..120                 (155, 115)        no: east of the view
--  900109  90..106,  125..135                 (98, 130)         yes: crosses the east edge, point inside
--  900110  96..110,  140..150                 (103, 145)        no: crosses the east edge, point outside
--  900111  -5..5,    125..135                 (0, 130)          yes: crosses the west edge, point on it
--  900112  U, 80..110, 170..200, open west    (105, 185)        no: centroid (96.43, 185) is inside the view
--  900113  U, -20..10, 170..200, open west    (5, 185)          yes: centroid (-3.57, 185) is outside the view
--
-- A U open to the west: a 30 × 30 square less a 20 × 10 notch cut into its west side
-- (y 180..190). Its centroid is (900 × 15 − 200 × 10) / 700 = 16.43 m from its west edge, at
-- the U's mid-height, y = 185: inside the notch, so outside the footprint. ST_PointOnSurface
-- scans the line y = 185, where the footprint is only the solid east bar (20 to 30 m from the
-- west edge), and takes that bar's middle, 25 m from the west edge.
--
-- Attributes of the nine buildings in the view (blank: null, empty text or an empty list):
--
--  id      land use               material  year  storeys      street        height (real)
--  900101  {Residential}          Brick     1950  2            Fixture Lane  2.3
--  900102  {Residential,Retail}   Stone     1985  4            null          10.5
--  900103  {Retail}               Brick     null  1            '' (empty)    null
--  900104  null                   Brick     2001  0 (default)  null          null
--  900105  {Residential}          null      1960  3            null          null
--  900106  {} (empty)             null      null  0 (default)  null          null
--  900109  {Industry}             Steel     1990  5            null          null
--  900111  {Residential}          Stone     1975  2            null          null
--  900113  {Retail}               Brick     1901  1            null          null
--
-- The four outside the view are {Residential}, Brick, with years 1950 (900107, 900108),
-- 1991 (900110) and 1900 (900112). Nobody has a typology recorded, and no building is
-- recorded as Agriculture, Wood or Reinforced Concrete, values the fixture catalogue allows.

INSERT INTO geometries (geometry_id, source_id, geometry_geom) VALUES
    (900101, 'fixture', ST_GeomFromText('POLYGON((10 110, 20 110, 20 120, 10 120, 10 110))', 3857)),
    (900102, 'fixture', ST_GeomFromText('POLYGON((30 110, 40 110, 40 120, 30 120, 30 110))', 3857)),
    (900103, 'fixture', ST_GeomFromText('POLYGON((50 110, 60 110, 60 120, 50 120, 50 110))', 3857)),
    (900104, 'fixture', ST_GeomFromText('POLYGON((70 110, 80 110, 80 120, 70 120, 70 110))', 3857)),
    (900105, 'fixture', ST_GeomFromText('POLYGON((10 140, 20 140, 20 150, 10 150, 10 140))', 3857)),
    (900106, 'fixture', ST_GeomFromText('POLYGON((30 140, 40 140, 40 150, 30 150, 30 140))', 3857)),
    (900107, 'fixture', ST_GeomFromText('POLYGON((10 300, 20 300, 20 310, 10 310, 10 300))', 3857)),
    (900108, 'fixture', ST_GeomFromText('POLYGON((150 110, 160 110, 160 120, 150 120, 150 110))', 3857)),
    (900109, 'fixture', ST_GeomFromText('POLYGON((90 125, 106 125, 106 135, 90 135, 90 125))', 3857)),
    (900110, 'fixture', ST_GeomFromText('POLYGON((96 140, 110 140, 110 150, 96 150, 96 140))', 3857)),
    (900111, 'fixture', ST_GeomFromText('POLYGON((-5 125, 5 125, 5 135, -5 135, -5 125))', 3857)),
    (900112, 'fixture', ST_GeomFromText(
        'POLYGON((80 170, 110 170, 110 200, 80 200, 80 190, 100 190, 100 180, 80 180, 80 170))', 3857)),
    (900113, 'fixture', ST_GeomFromText(
        'POLYGON((-20 170, 10 170, 10 200, -20 200, -20 190, 0 190, 0 180, -20 180, -20 170))', 3857));

-- size_storeys_core DEFAULT is colouring-core's default, 0. size_height_apex is a real (float4) column.
INSERT INTO buildings
    (building_id, geometry_id, current_landuse_group, construction_core_material, date_year, size_storeys_core,
     location_street, size_height_apex)
VALUES
    (900101, 900101, '{Residential}', 'Brick', 1950, 2, 'Fixture Lane', 2.3),
    (900102, 900102, '{Residential,Retail}', 'Stone', 1985, 4, NULL, 10.5),
    (900103, 900103, '{Retail}', 'Brick', NULL, 1, '', NULL),
    (900104, 900104, NULL, 'Brick', 2001, DEFAULT, NULL, NULL),
    (900105, 900105, '{Residential}', NULL, 1960, 3, NULL, NULL),
    (900106, 900106, '{}', NULL, NULL, DEFAULT, NULL, NULL),
    (900107, 900107, '{Residential}', 'Brick', 1950, 4, NULL, NULL),
    (900108, 900108, '{Residential}', 'Brick', 1950, 4, NULL, NULL),
    (900109, 900109, '{Industry}', 'Steel', 1990, 5, NULL, NULL),
    (900110, 900110, '{Residential}', 'Brick', 1991, 4, NULL, NULL),
    (900111, 900111, '{Residential}', 'Stone', 1975, 2, NULL, NULL),
    (900112, 900112, '{Residential}', 'Brick', 1900, 4, NULL, NULL),
    (900113, 900113, '{Retail}', 'Brick', 1901, 1, NULL, NULL);
