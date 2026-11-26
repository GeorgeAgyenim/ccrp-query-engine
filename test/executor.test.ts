// The executor is the engine's only path to the database. These tests run it as the
// engine's login against the main test database (see scripts/test.ts).

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createExecutor, QueryTimeoutError, type Executor } from '../src/executor.ts';
import { testEnvironment } from './support/databases.ts';

const env = testEnvironment();

describe('executor, as the engine login', () => {
  let executor: Executor;
  before(() => {
    executor = createExecutor({ databaseUrl: env.mainEngineUrl, statementTimeoutMs: 5_000 });
  });
  after(() => executor.close());

  test('reads buildings with their footprints', async () => {
    const rows = await executor.read((query) =>
      query(
        `SELECT b.building_id, ST_AsText(g.geometry_geom) AS footprint, ST_SRID(g.geometry_geom) AS srid
           FROM buildings b JOIN geometries g USING (geometry_id)
          WHERE b.building_id = ANY($1)
          ORDER BY b.building_id`,
        [[900001, 900002]],
      ),
    );
    assert.deepEqual(rows, [
      { building_id: 900001, footprint: 'POLYGON((0 0,10 0,10 10,0 10,0 0))', srid: 3857 },
      { building_id: 900002, footprint: 'POLYGON((20 0,30 0,30 10,20 10,20 0))', srid: 3857 },
    ]);
  });

  for (const table of ['users', 'user_sessions', 'user_password_reset_tokens', 'logs']) {
    test(`is refused on the host's ${table} table`, async () => {
      await assert.rejects(
        executor.read((query) => query(`SELECT * FROM ${table}`)),
        { code: '42501' }, // insufficient_privilege
      );
    });
  }

  test('has a write refused', async () => {
    await assert.rejects(
      executor.read((query) => query('UPDATE geometries SET source_id = $1 WHERE geometry_id = $2', ['changed', 900001])),
      { code: '25006' }, // read_only_sql_transaction
    );
    const [row] = await executor.read((query) =>
      query('SELECT source_id FROM geometries WHERE geometry_id = $1', [900001]),
    );
    assert.equal(row?.['source_id'], 'fixture');
  });

  test('cannot end its read-only transaction to write outside it', async () => {
    await assert.rejects(
      executor.read((query) => query("COMMIT; UPDATE geometries SET source_id = 'changed' WHERE geometry_id = 900001")),
      { code: '42601' }, // syntax_error: one statement per query
    );
    const [row] = await executor.read((query) =>
      query('SELECT source_id FROM geometries WHERE geometry_id = $1', [900001]),
    );
    assert.equal(row?.['source_id'], 'fixture');
  });
});

describe('executor statement timeout', () => {
  // The test login has statement_timeout = 1h on its role (scripts/test.ts), so a
  // cancellation here comes from the timeout the executor sets in its transaction.
  test('cancels a query that runs longer than the timeout, then keeps working', async () => {
    const executor = createExecutor({ databaseUrl: env.mainEngineUrl, statementTimeoutMs: 200 });
    try {
      const started = performance.now();
      await assert.rejects(
        executor.read((query) => query('SELECT pg_sleep(10)')),
        (error: unknown) => {
          assert.ok(error instanceof QueryTimeoutError);
          assert.equal(error.timeoutMs, 200);
          return true;
        },
      );
      assert.ok(performance.now() - started < 5_000, 'cancelled well before the 10 s sleep ended');

      const [row] = await executor.read((query) => query('SELECT 1 AS one'));
      assert.equal(row?.['one'], 1);
    } finally {
      await executor.close();
    }
  });
});
