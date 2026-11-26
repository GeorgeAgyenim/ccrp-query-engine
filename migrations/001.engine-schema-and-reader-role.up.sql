-- 001 up: the engine's own schema, its migration record, and its read-only group role.
-- Decision record: docs/decisions/0007-engine-schema-role-and-migrations.md
--
-- Run by the engine's migrate command, inside one transaction, with a login that owns
-- the host's buildings and geometries tables (or can grant on them) and can create roles.

CREATE SCHEMA query_engine;

-- Which engine migrations this database has applied. The migrate command writes it;
-- the service reads it at start-up to check the database is up to date.
CREATE TABLE query_engine.migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

-- Roles belong to the whole PostgreSQL cluster, not to one database. A second database
-- on the same cluster (a frozen copy, say) reuses the role and adds its own grants.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'query_engine_reader') THEN
        CREATE ROLE query_engine_reader NOLOGIN;
    ELSIF EXISTS (
        SELECT FROM pg_catalog.pg_roles
        WHERE rolname = 'query_engine_reader'
          AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    ) THEN
        RAISE EXCEPTION 'role query_engine_reader exists but is not a plain no-login group role'
            USING HINT = 'The engine expects query_engine_reader to have no login and no attributes. Give the engine''s login its own name.';
    END IF;
END
$$;

-- Read the host's buildings and footprints (colouring-core's layout), and nothing else of the host's.
GRANT USAGE ON SCHEMA public TO query_engine_reader;
GRANT SELECT ON public.buildings, public.geometries TO query_engine_reader;

-- Read the engine's own tables. Every later migration that creates a table in this
-- schema grants SELECT on it explicitly; a test checks none is missed.
GRANT USAGE ON SCHEMA query_engine TO query_engine_reader;
GRANT SELECT ON query_engine.migrations TO query_engine_reader;
