// The start-up check: before serving, the service confirms that the database it points at
// has colouring-core's building and footprint layout, that the engine's migrations are
// current, and that it is logged in with a restricted login (the engine's group role and
// no more). Each problem is a plain sentence an operator can act on.

import type { Executor, Query } from './executor.ts';
import { compareMigrations, listMigrations, readAppliedMigrations } from './migrations.ts';

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

/** Every problem found, or an empty list when the service may start. */
export async function checkDatabase(executor: Executor): Promise<string[]> {
  const shipped = (await listMigrations()).map((migration) => migration.id);
  return executor.read(async (query) => {
    const [login] = await query<{ superuser: boolean }>(
      'SELECT rolsuper AS superuser FROM pg_catalog.pg_roles WHERE rolname = current_user',
    );
    if (login?.superuser === true) {
      return [
        "The engine's login is a superuser. The engine must log in with its own restricted login, " +
          `granted only the query_engine_reader role. ${SEE_GUIDE}`,
      ];
    }
    return [
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
  const run = 'Run `npm run migrate -- up` with QUERY_ENGINE_MIGRATION_DATABASE_URL set.';
  const [schema] = await query<{ present: boolean; usable: boolean | null }>(
    `SELECT n.oid IS NOT NULL AS present, has_schema_privilege(n.oid, 'USAGE') AS usable
       FROM (SELECT to_regnamespace($1) AS oid) AS n`,
    [ENGINE_SCHEMA],
  );
  if (schema?.present !== true) {
    return [`The engine's migrations have not been run on this database. ${run} ${SEE_GUIDE}`];
  }
  if (schema.usable !== true) {
    return [`The engine's login cannot read the ${ENGINE_SCHEMA} schema. Grant the login the query_engine_reader role. ${SEE_GUIDE}`];
  }
  const applied = await readAppliedMigrations(query);
  const { pending, unknown } = compareMigrations(applied, shipped);
  const problems: string[] = [];
  if (pending.length > 0) {
    problems.push(`This database is missing engine migration(s) ${pending.join(', ')}. ${run}`);
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
// may change nothing. Relations that belong to an extension (PostGIS's spatial_ref_sys and
// catalogue views) are readable by everyone by default and are ignored here.
async function checkLoginReachesNoMore(query: Query): Promise<string[]> {
  const reachable = await query<{ schema_name: string; relation: string; can_select: boolean; can_write: boolean }>(
    `SELECT n.nspname AS schema_name, c.relname AS relation,
            has_table_privilege(c.oid, 'SELECT') AS can_select,
            has_table_privilege(c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE') AS can_write
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg\\_%'
        AND NOT EXISTS (SELECT FROM pg_catalog.pg_depend d
                         WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
        AND (has_table_privilege(c.oid, 'SELECT') OR has_table_privilege(c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE'))
      ORDER BY 1, 2`,
  );
  const allowedReads = new Set(REQUIRED_LAYOUT.map((required) => `${HOST_SCHEMA}.${required.table}`));
  const tooMuch = 'The engine must log in with its own restricted login, granted only the query_engine_reader role.';
  const problems: string[] = [];
  for (const row of reachable) {
    const qualified = `${row.schema_name}.${row.relation}`;
    if (row.can_select && row.schema_name !== ENGINE_SCHEMA && !allowedReads.has(qualified)) {
      problems.push(`The engine's login can read ${qualified}. ${tooMuch} ${SEE_GUIDE}`);
    }
    if (row.can_write) {
      problems.push(`The engine's login can change ${qualified}. ${tooMuch} ${SEE_GUIDE}`);
    }
  }
  return problems;
}
