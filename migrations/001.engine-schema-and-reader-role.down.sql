-- 001 down: remove the engine's schema and this database's grants to its group role.
-- The migrate command deletes this migration's row from query_engine.migrations first,
-- in the same transaction.

REVOKE SELECT ON public.buildings, public.geometries FROM query_engine_reader;
REVOKE USAGE ON SCHEMA public FROM query_engine_reader;

DROP TABLE query_engine.migrations;
-- No CASCADE: if anything unexpected is left in the schema, stop instead of deleting it.
DROP SCHEMA query_engine;

-- The role is cluster-wide. Drop it only when no other database still grants it anything.
-- Dropping it also removes it from any login it was granted to.
DO $$
BEGIN
    DROP ROLE query_engine_reader;
EXCEPTION WHEN dependent_objects_still_exist THEN
    RAISE NOTICE 'query_engine_reader kept: another database in this cluster still grants it privileges';
END
$$;
