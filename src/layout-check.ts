// The start-up check: before serving, the service confirms that the database it points at
// has colouring-core's building and footprint layout, that the engine's migrations are
// current, and that it is logged in with a restricted login (the engine's group role and
// no more). Each problem is a plain sentence an operator can act on.

import type { Executor, Query } from './executor.ts';
import { compareMigrations, listMigrations, readAppliedMigrations } from './migrations.ts';
import { MIGRATION_DATABASE_URL } from './settings.ts';

const HOST_SCHEMA = 'public';
const ENGINE_SCHEMA = 'query_engine';
const FOOTPRINT_SRID = 3857;

type ColumnKind = 'integer' | 'geometry';

// The parts of colouring-core's layout the engine reads. Later tickets add the attribute
// columns, checked against the field catalogue.
const REQUIRED_LAYOUT: ReadonlyArray<{ table: string; columns: Readonly<Record<string, ColumnKind>> }> = [
  { table: 'buildings', columns: { building_id: 'integer', geometry_id: 'integer' } },
  { table: 'geometries', columns: { geometry_id: 'integer', geometry_geom: 'geometry' } },
];

const INTEGER_TYPES = ['int2', 'int4', 'int8'];

const SEE_GUIDE = 'See docs/host-setup.md.';
const RUN_MIGRATIONS_HINT = `Run \`npm run migrate -- up\` with ${MIGRATION_DATABASE_URL} set.`;
const RESTRICTED_LOGIN_HINT =
  'The engine must log in with its own restricted login, granted only the query_engine_reader role.';

// Role attributes that reach past table privileges: replication streams the whole database,
// BYPASSRLS skips row-level security, and the other two administer the server.
const FORBIDDEN_ATTRIBUTES = [
  { column: 'rolcreatedb', name: 'CREATEDB' },
  { column: 'rolcreaterole', name: 'CREATEROLE' },
  { column: 'rolreplication', name: 'REPLICATION' },
  { column: 'rolbypassrls', name: 'BYPASSRLS' },
] as const;

/** Every problem found, or an empty list when the service may start. */
export async function checkDatabase(executor: Executor): Promise<string[]> {
  const shipped = (await listMigrations()).map((migration) => migration.id);
  return executor.read(async (query) => {
    const [login] = await query<Record<string, unknown>>(
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
         FROM pg_catalog.pg_roles WHERE rolname = current_user`,
    );
    if (login?.['rolsuper'] === true) {
      return [`The engine's login is a superuser. ${RESTRICTED_LOGIN_HINT} ${SEE_GUIDE}`];
    }
    const attributes = FORBIDDEN_ATTRIBUTES.filter((attribute) => login?.[attribute.column] === true).map(
      (attribute) => `The engine's login has the ${attribute.name} attribute. ${RESTRICTED_LOGIN_HINT} ${SEE_GUIDE}`,
    );
    return [
      ...attributes,
      ...(await checkHostLayout(query)),
      ...(await checkEngineMigrations(query, shipped)),
      ...(await checkLoginReachesNoMore(query)),
    ];
  });
}

async function checkHostLayout(query: Query): Promise<string[]> {
  const problems: string[] = [];
  const tables = REQUIRED_LAYOUT.map((required) => required.table);
  const found = await query<{ table_name: string; present: boolean; can_select: boolean | null }>(
    `SELECT t.table_name,
            c.oid IS NOT NULL AS present,
            has_table_privilege(c.oid, 'SELECT') AS can_select
       FROM unnest($1::text[]) AS t(table_name)
       LEFT JOIN pg_catalog.pg_class c ON c.oid = to_regclass(format('%I.%I', $2::text, t.table_name))`,
    [tables, HOST_SCHEMA],
  );
  const columns = await query<{ table_name: string; column_name: string; type_name: string; typmod: number }>(
    `SELECT c.relname AS table_name, a.attname AS column_name, ty.typname AS type_name, a.atttypmod AS typmod
       FROM pg_catalog.pg_attribute a
       JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
       JOIN pg_catalog.pg_type ty ON ty.oid = a.atttypid
      WHERE c.oid IN (SELECT to_regclass(format('%I.%I', $2::text, name)) FROM unnest($1::text[]) AS name)
        AND a.attnum > 0 AND NOT a.attisdropped`,
    [tables, HOST_SCHEMA],
  );

  for (const required of REQUIRED_LAYOUT) {
    const qualified = `${HOST_SCHEMA}.${required.table}`;
    const table = found.find((row) => row.table_name === required.table);
    if (table?.present !== true) {
      problems.push(
        `The database has no table ${qualified}. The engine needs colouring-core's buildings and ` +
          `footprint tables (buildings and geometries). ${SEE_GUIDE}`,
      );
      continue;
    }
    if (table.can_select !== true) {
      problems.push(
        `The engine's login cannot read ${qualified}. Grant the login the query_engine_reader role, ` +
          `and run the engine's migrations if they have not been run. ${SEE_GUIDE}`,
      );
    }
    for (const [name, kind] of Object.entries(required.columns)) {
      const column = columns.find((row) => row.table_name === required.table && row.column_name === name);
      if (column === undefined) {
        problems.push(`Table ${qualified} has no column ${name}. The engine needs colouring-core's layout. ${SEE_GUIDE}`);
      } else if (kind === 'integer' && !INTEGER_TYPES.includes(column.type_name)) {
        problems.push(`Column ${qualified}.${name} is ${column.type_name}; the engine needs an integer.`);
      } else if (kind === 'geometry') {
        if (column.type_name !== 'geometry') {
          problems.push(`Column ${qualified}.${name} is ${column.type_name}; the engine needs a PostGIS geometry.`);
          continue;
        }
        const [srid] = await query<{ srid: number }>('SELECT postgis_typmod_srid($1::integer) AS srid', [column.typmod]);
        if (srid?.srid !== FOOTPRINT_SRID) {
          problems.push(
            `Column ${qualified}.${name} has SRID ${srid?.srid ?? 'unknown'}; the engine needs ${FOOTPRINT_SRID}, ` +
              "the projection colouring-core stores footprints in.",
          );
        }
      }
    }
  }
  return problems;
}

async function checkEngineMigrations(query: Query, shipped: readonly string[]): Promise<string[]> {
  const record = `${ENGINE_SCHEMA}.migrations`;
  const notRun = `The engine's migrations have not been run on this database. ${RUN_MIGRATIONS_HINT} ${SEE_GUIDE}`;
  const cannotRead =
    `The engine's login cannot read ${record}. Grant the login the query_engine_reader role, ` +
    `and run the engine's migrations again if the grant is still missing. ${SEE_GUIDE}`;
  const [schema] = await query<{ present: boolean; usable: boolean | null }>(
    `SELECT n.oid IS NOT NULL AS present, has_schema_privilege(n.oid, 'USAGE') AS usable
       FROM (SELECT to_regnamespace($1) AS oid) AS n`,
    [ENGINE_SCHEMA],
  );
  if (schema?.present !== true) return [notRun];
  if (schema.usable !== true) return [cannotRead];
  // Only now: looking a name up in a schema the login cannot use is itself an error.
  const [table] = await query<{ present: boolean; readable: boolean | null }>(
    `SELECT t.oid IS NOT NULL AS present, has_table_privilege(t.oid, 'SELECT') AS readable
       FROM (SELECT to_regclass($1) AS oid) AS t`,
    [record],
  );
  if (table?.present !== true) return [notRun];
  if (table.readable !== true) return [cannotRead];
  const applied = await readAppliedMigrations(query);
  const { pending, unknown } = compareMigrations(applied, shipped);
  const problems: string[] = [];
  if (pending.length > 0) {
    problems.push(`This database is missing engine migration(s) ${pending.join(', ')}. ${RUN_MIGRATIONS_HINT}`);
  }
  if (unknown.length > 0) {
    problems.push(
      `This database has engine migration(s) ${unknown.join(', ')} that this engine version does not ship. ` +
        'Run the engine version that applied them.',
    );
  }
  return problems;
}

// The login may read the host's buildings and geometries and the engine's own tables, and
// may change, create or draw from nothing. Column-level grants count as well as table-level
// ones. Objects that belong to an extension (PostGIS's spatial_ref_sys and catalogue views)
// are readable by every login by default and are ignored here.
async function checkLoginReachesNoMore(query: Query): Promise<string[]> {
  const reachable = await query<{
    schema_name: string;
    relation: string;
    is_sequence: boolean;
    can_select: boolean;
    can_write: boolean;
  }>(
    `SELECT schema_name, relation, is_sequence, can_select, can_write
       FROM (SELECT n.nspname AS schema_name, c.relname AS relation, c.relkind = 'S' AS is_sequence,
                    CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(c.oid, 'USAGE, SELECT, UPDATE')
                         ELSE has_any_column_privilege(c.oid, 'SELECT') END AS can_select,
                    CASE WHEN c.relkind = 'S' THEN false
                         ELSE has_any_column_privilege(c.oid, 'INSERT, UPDATE, REFERENCES')
                              OR has_table_privilege(c.oid, 'DELETE, TRUNCATE, TRIGGER')
                              -- MAINTAIN (VACUUM, LOCK TABLE, ...) exists from PostgreSQL 17
                              OR CASE WHEN current_setting('server_version_num')::integer >= 170000
                                      THEN has_table_privilege(c.oid, 'MAINTAIN') ELSE false END
                    END AS can_write
               FROM pg_catalog.pg_class c
               JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
              WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
                AND n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg\\_%'
                AND NOT EXISTS (SELECT FROM pg_catalog.pg_depend d
                                 WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
            ) AS privileges
      WHERE can_select OR can_write
      ORDER BY 1, 2`,
  );
  const creatable = await query<{ schema_name: string }>(
    `SELECT nspname AS schema_name FROM pg_catalog.pg_namespace
      WHERE nspname <> 'information_schema' AND nspname NOT LIKE 'pg\\_%' AND has_schema_privilege(oid, 'CREATE')
      ORDER BY 1`,
  );

  const allowedReads = new Set(REQUIRED_LAYOUT.map((required) => `${HOST_SCHEMA}.${required.table}`));
  const problems: string[] = [];
  for (const row of reachable) {
    const qualified = `${row.schema_name}.${row.relation}`;
    if (row.is_sequence) {
      problems.push(`The engine's login can use sequence ${qualified}. ${RESTRICTED_LOGIN_HINT} ${SEE_GUIDE}`);
      continue;
    }
    if (row.can_select && row.schema_name !== ENGINE_SCHEMA && !allowedReads.has(qualified)) {
      problems.push(`The engine's login can read ${qualified}. ${RESTRICTED_LOGIN_HINT} ${SEE_GUIDE}`);
    }
    if (row.can_write) {
      problems.push(`The engine's login can change ${qualified}. ${RESTRICTED_LOGIN_HINT} ${SEE_GUIDE}`);
    }
  }
  for (const { schema_name } of creatable) {
    problems.push(`The engine's login can create objects in schema ${schema_name}. ${RESTRICTED_LOGIN_HINT} ${SEE_GUIDE}`);
  }
  return problems;
}
