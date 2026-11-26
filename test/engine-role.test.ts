// The engine's group role, query_engine_reader, created by engine migration 001.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { copyOfCoreDatabase, testEnvironment, withClient } from './support/databases.ts';
import { runNode } from './support/processes.ts';

const env = testEnvironment();

// Relations a role can read through PostgreSQL's PUBLIC defaults when PostGIS is installed:
// the spatial reference table that coordinate transforms read, and two catalogue views.
const POSTGIS_PUBLIC_RELATIONS = ['public.geography_columns', 'public.geometry_columns', 'public.spatial_ref_sys'];

async function readablePrivileges(adminUrl: string) {
  return withClient(adminUrl, async (client) => {
    const { rows: version } = await client.query<{ server_version_num: string }>('SHOW server_version_num');
    // MAINTAIN (VACUUM, ANALYZE, REINDEX and the like) exists from PostgreSQL 17.
    const tableWrites = `DELETE, TRUNCATE, TRIGGER${Number(version[0]?.server_version_num) >= 170000 ? ', MAINTAIN' : ''}`;
    // has_any_column_privilege also sees grants on single columns, which has_table_privilege misses.
    const relations = await client.query<{ relation: string; can_select: boolean; can_write: boolean }>(
      `SELECT format('%s.%s', n.nspname, c.relname) AS relation,
              has_any_column_privilege('query_engine_reader', c.oid, 'SELECT') AS can_select,
              has_any_column_privilege('query_engine_reader', c.oid, 'INSERT, UPDATE, REFERENCES')
                OR has_table_privilege('query_engine_reader', c.oid, $1) AS can_write
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_toast%'`,
      [tableWrites],
    );
    const sequences = await client.query<{ relation: string }>(
      `SELECT format('%s.%s', n.nspname, c.relname) AS relation
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE CASE WHEN c.relkind = 'S' -- CASE, so the function never sees a non-sequence
                   THEN has_sequence_privilege('query_engine_reader', c.oid, 'USAGE, SELECT, UPDATE') ELSE false END`,
    );
    const schemas = await client.query<{ schema: string; can_use: boolean; can_create: boolean }>(
      `SELECT nspname AS schema,
              has_schema_privilege('query_engine_reader', oid, 'USAGE') AS can_use,
              has_schema_privilege('query_engine_reader', oid, 'CREATE') AS can_create
         FROM pg_namespace WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND nspname NOT LIKE 'pg\\_%'`,
    );
    return {
      selectable: relations.rows.filter((r) => r.can_select).map((r) => r.relation).sort(),
      writable: relations.rows.filter((r) => r.can_write).map((r) => r.relation),
      sequences: sequences.rows.map((r) => r.relation),
      usableSchemas: schemas.rows.filter((s) => s.can_use).map((s) => s.schema).sort(),
      creatableSchemas: schemas.rows.filter((s) => s.can_create).map((s) => s.schema),
    };
  });
}

describe('query_engine_reader', () => {
  test('can SELECT the host buildings and footprints and the engine tables, and nothing else', async () => {
    const privileges = await readablePrivileges(env.mainAdminUrl);
    assert.deepEqual(
      privileges.selectable,
      ['public.buildings', 'public.geometries', 'query_engine.migrations', ...POSTGIS_PUBLIC_RELATIONS].sort(),
    );
    assert.deepEqual(privileges.usableSchemas, ['public', 'query_engine']);
  });

  test('can write nothing and create nothing', async () => {
    const privileges = await readablePrivileges(env.mainAdminUrl);
    assert.deepEqual(privileges.writable, []);
    assert.deepEqual(privileges.sequences, []);
    assert.deepEqual(privileges.creatableSchemas, []);
  });

  test('can SELECT every table in the engine schema', async () => {
    const missing = await withClient(env.mainAdminUrl, async (client) => {
      const result = await client.query<{ relation: string }>(
        `SELECT format('%s.%s', n.nspname, c.relname) AS relation
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'query_engine' AND c.relkind IN ('r', 'p', 'v', 'm')
            AND NOT has_table_privilege('query_engine_reader', c.oid, 'SELECT')`,
      );
      return result.rows.map((r) => r.relation);
    });
    assert.deepEqual(missing, []);
  });

  test('cannot log in', async () => {
    const roles = await withClient(env.mainAdminUrl, (client) =>
      client.query(`SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
                      FROM pg_roles WHERE rolname = 'query_engine_reader'`),
    );
    assert.deepEqual(roles.rows, [
      {
        rolcanlogin: false,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
      },
    ]);
  });

  test("refuses a write by a login granted it, even outside the engine's read-only transactions", async () => {
    await withClient(env.mainEngineUrl, async (client) => {
      await assert.rejects(
        client.query(`INSERT INTO geometries (geometry_id, source_id) VALUES (999999, 'not allowed')`),
        { code: '42501' }, // insufficient_privilege
      );
      await assert.rejects(client.query(`DELETE FROM buildings`), { code: '42501' });
    });
  });
});

describe('migrate command', () => {
  const migrate = (action: string, databaseUrl: string) =>
    runNode(['src/cli.ts', 'migrate', action], { QUERY_ENGINE_MIGRATION_DATABASE_URL: databaseUrl });

  const engineCanRead = (engineUrl: string) =>
    withClient(engineUrl, (client) => client.query('SELECT count(*) FROM buildings JOIN geometries USING (geometry_id)')).then(
      () => true,
      (error: { code?: string }) => {
        if (error.code === '42501') return false;
        throw error;
      },
    );

  test('up grants the engine its reads, down takes them away, and up again restores them', async () => {
    const copy = await copyOfCoreDatabase(env);
    try {
      assert.equal(await engineCanRead(copy.engineUrl), false, 'core alone grants the engine nothing');

      const up = await migrate('up', copy.adminUrl);
      assert.equal(up.code, 0, up.stderr);
      assert.match(up.stdout, /Applied 001\.engine-schema-and-reader-role/);
      assert.equal(await engineCanRead(copy.engineUrl), true);

      const again = await migrate('up', copy.adminUrl);
      assert.equal(again.code, 0, again.stderr);
      assert.match(again.stdout, /Nothing to apply/);

      const down = await migrate('down', copy.adminUrl);
      assert.equal(down.code, 0, down.stderr);
      assert.match(down.stdout, /Reverted 001\.engine-schema-and-reader-role/);
      assert.equal(await engineCanRead(copy.engineUrl), false);
      await withClient(copy.adminUrl, async (client) => {
        const { rows } = await client.query(`SELECT to_regnamespace('query_engine') AS schema`);
        assert.equal(rows[0].schema, null, 'down removes the engine schema');
      });
      // The role is cluster-wide: down keeps it while another database still grants it
      // something, as the main test database always does during the suite.
      await withClient(copy.adminUrl, async (client) => {
        const { rows } = await client.query(
          `SELECT r.oid IS NOT NULL AS kept,
                  EXISTS (SELECT FROM pg_shdepend d JOIN pg_database db ON db.oid = d.dbid
                           WHERE d.refobjid = r.oid AND db.datname <> current_database()) AS used_elsewhere,
                  EXISTS (SELECT FROM pg_shdepend d JOIN pg_database db ON db.oid = d.dbid
                           WHERE d.refobjid = r.oid AND db.datname = current_database()) AS used_here
             FROM (SELECT) AS one LEFT JOIN pg_roles r ON r.rolname = 'query_engine_reader'`,
        );
        assert.deepEqual(rows[0], { kept: true, used_elsewhere: true, used_here: false });
      });

      const reapplied = await migrate('up', copy.adminUrl);
      assert.equal(reapplied.code, 0, reapplied.stderr);
      assert.equal(await engineCanRead(copy.engineUrl), true);
    } finally {
      await copy.drop();
    }
  });

  test('status lists applied and pending migrations', async () => {
    const copy = await copyOfCoreDatabase(env);
    try {
      const before = await migrate('status', copy.adminUrl);
      assert.equal(before.code, 0, before.stderr);
      assert.match(before.stdout, /Pending: 001\.engine-schema-and-reader-role/);
      await migrate('up', copy.adminUrl);
      const after = await migrate('status', copy.adminUrl);
      assert.match(after.stdout, /Applied: 001\.engine-schema-and-reader-role/);
      assert.match(after.stdout, /Pending: none/);
    } finally {
      await copy.drop();
    }
  });

  test('refuses to run without a migration database setting', async () => {
    const result = await runNode(['src/cli.ts', 'migrate', 'up'], {});
    assert.equal(result.code, 1);
    assert.match(result.stderr, /QUERY_ENGINE_MIGRATION_DATABASE_URL is not set/);
  });
});
