// The service as an operator runs it: node src/main.ts with settings in its environment.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { migrateUp } from '../src/migrations.ts';
import { copyOfCoreDatabase, testEnvironment, withClient, type DatabaseCopy } from './support/databases.ts';
import { runNode } from './support/processes.ts';
import { freePort, startService } from './support/service.ts';

const env = testEnvironment();

describe('health endpoint', () => {
  test('answers ok when the database has the host layout and the engine login', async () => {
    const service = await startService({ QUERY_ENGINE_DATABASE_URL: env.mainEngineUrl });
    try {
      const response = await fetch(`${service.baseUrl}/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'ok' });
    } finally {
      await service.stop();
    }
  });

  test('answers unavailable when the database stops answering', async () => {
    const copy = await migratedCopy();
    const service = await startService({ QUERY_ENGINE_DATABASE_URL: copy.engineUrl });
    try {
      await copy.drop(); // ends the service's connections and removes the database
      const response = await fetch(`${service.baseUrl}/health`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { status: 'unavailable' });
    } finally {
      await service.stop();
    }
  });

  test('logs the route and outcome of a request, not the query string or the client address', async () => {
    const service = await startService({ QUERY_ENGINE_DATABASE_URL: env.mainEngineUrl });
    try {
      await fetch(`${service.baseUrl}/health?place=private-marker`);
    } finally {
      await service.stop();
    }
    const requestLines = service
      .stdout()
      .split('\n')
      .filter((line) => line.includes('"route"'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.ok(
      requestLines.some((line) => line['route'] === '/health' && line['statusCode'] === 200),
      'a request line names the route and status',
    );
    assert.doesNotMatch(service.stdout(), /private-marker/);
    assert.doesNotMatch(service.stdout(), /remoteAddress|"ip"/);
  });
});

describe('start-up check', () => {
  const start = (settings: Record<string, string>) => runNode(['src/main.ts'], settings, 20_000);

  async function refusal(settings: Record<string, string>, expected: RegExp): Promise<string> {
    const result = await start({ QUERY_ENGINE_PORT: String(await freePort()), ...settings });
    assert.equal(result.code, 1, `expected the service to refuse to start; it printed:\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /The query engine cannot start/);
    assert.match(result.stderr, expected);
    return result.stderr;
  }

  test('refuses to start without a database setting', async () => {
    await refusal({}, /QUERY_ENGINE_DATABASE_URL is not set/);
  });

  test('refuses to start with a statement timeout that is not a whole number of milliseconds', async () => {
    await refusal(
      { QUERY_ENGINE_DATABASE_URL: env.mainEngineUrl, QUERY_ENGINE_STATEMENT_TIMEOUT_MS: '10s' },
      /QUERY_ENGINE_STATEMENT_TIMEOUT_MS must be a whole number of milliseconds/,
    );
  });

  test('refuses to start when the database cannot be reached, without printing the password', async () => {
    const unreachable = new URL(env.mainEngineUrl);
    unreachable.port = String(await freePort());
    const stderr = await refusal({ QUERY_ENGINE_DATABASE_URL: unreachable.toString() }, /could not reach the database server/);
    assert.ok(!stderr.includes(decodeURIComponent(unreachable.password)), 'the password is not printed');
  });

  const brokenLayouts: Array<{ name: string; sql: string; expected: RegExp }> = [
    {
      name: 'the footprint table is missing',
      sql: 'DROP TABLE geometries CASCADE',
      expected: /The database has no table public\.geometries/,
    },
    {
      name: 'the buildings table is missing',
      sql: 'DROP TABLE buildings CASCADE',
      expected: /The database has no table public\.buildings/,
    },
    {
      name: 'the footprint geometry column is missing',
      sql: 'ALTER TABLE geometries DROP COLUMN geometry_geom',
      expected: /Table public\.geometries has no column geometry_geom/,
    },
    {
      name: "the buildings' footprint link is missing",
      sql: 'ALTER TABLE buildings DROP COLUMN geometry_id',
      expected: /Table public\.buildings has no column geometry_id/,
    },
    {
      name: 'footprints are not stored in EPSG:3857',
      sql: 'ALTER TABLE geometries ALTER COLUMN geometry_geom TYPE geometry(GEOMETRY, 4326) USING ST_Transform(geometry_geom, 4326)',
      expected: /public\.geometries\.geometry_geom has SRID 4326; the engine needs 3857/,
    },
  ];
  for (const layout of brokenLayouts) {
    test(`refuses to start when ${layout.name}`, async () => {
      const copy = await migratedCopy();
      try {
        await withClient(copy.adminUrl, (client) => client.query(layout.sql));
        await refusal({ QUERY_ENGINE_DATABASE_URL: copy.engineUrl }, layout.expected);
      } finally {
        await copy.drop();
      }
    });
  }

  test("refuses to start when the engine's migrations have not been run", async () => {
    const copy = await copyOfCoreDatabase(env);
    try {
      await refusal({ QUERY_ENGINE_DATABASE_URL: copy.engineUrl }, /The engine's migrations have not been run/);
    } finally {
      await copy.drop();
    }
  });

  test('refuses to start when logged in as a superuser', async () => {
    await refusal({ QUERY_ENGINE_DATABASE_URL: env.mainAdminUrl }, /The engine's login is a superuser/);
  });

  test("refuses to start when the engine's login can read a contributor table", async () => {
    const copy = await migratedCopy();
    try {
      await withClient(copy.adminUrl, (client) => client.query('GRANT SELECT ON users TO query_engine_reader'));
      await refusal({ QUERY_ENGINE_DATABASE_URL: copy.engineUrl }, /The engine's login can read public\.users/);
    } finally {
      await copy.drop();
    }
  });

  test("refuses to start when the engine's login can change buildings", async () => {
    const copy = await migratedCopy();
    try {
      await withClient(copy.adminUrl, (client) => client.query('GRANT UPDATE ON buildings TO query_engine_reader'));
      await refusal({ QUERY_ENGINE_DATABASE_URL: copy.engineUrl }, /The engine's login can change public\.buildings/);
    } finally {
      await copy.drop();
    }
  });
});

async function migratedCopy(): Promise<DatabaseCopy> {
  const copy = await copyOfCoreDatabase(env);
  await migrateUp(copy.adminUrl);
  return copy;
}
