// How long the engine takes to answer a question about a city's worth of buildings: the real
// service over HTTP, on its own copy of the database holding the 20,000 made-up buildings of
// test/fixtures/many-buildings.sql. The target is the first host's: an answer within 2 s
// (query-engine ticket 19). Before ADR-0012 this question took about 3.9 s once the database had
// gathered its statistics; it now takes under 0.1 s, so the margin is wide.
//
// The statistics matter because PostgreSQL uses them to choose how to carry out a query, and
// they exist only after ANALYZE (or the database's own background maintenance). Each test asks
// the same question in one of the two states, in this order: node:test runs a file's tests one
// after another, and the second test runs ANALYZE. The old query failed only the second; the
// first covers the state every newly loaded database starts in.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import type { Answer, Plan } from '../schemas/query-engine.d.ts';
import { migrateUp } from '../src/migrations.ts';
import { copyOfCoreDatabase, testEnvironment, withClient, type DatabaseCopy } from './support/databases.ts';
import { startService, type RunningService } from './support/service.ts';

const env = testEnvironment();

/** Run-time target, in milliseconds. */
const TARGET_MS = 2_000;

/** x −111 to 2226 m, y −111 to 1113 m in EPSG:3857: the whole grid, which spans x 3 to 1997 m, y 3 to 997 m. */
const PLAN: Plan = {
  version: '1.0.0',
  area: { type: 'viewport', bbox: [-0.001, -0.001, 0.02, 0.01] },
  steps: [
    {
      type: 'filter',
      filter: {
        op: 'and',
        args: [
          { op: '>=', args: [{ property: 'date_year' }, 2000] },
          { op: '=', args: [{ property: 'construction_core_material' }, 'Brick'] },
        ],
      },
    },
  ],
  outputs: [{ type: 'number' }],
};

let copy: DatabaseCopy | undefined;
let service: RunningService | undefined;
before(async () => {
  copy = await copyOfCoreDatabase(env);
  await migrateUp(copy.adminUrl);
  const fixture = readFileSync(new URL('fixtures/many-buildings.sql', import.meta.url), 'utf8');
  await withClient(copy.adminUrl, (client) => client.query(fixture));
  service = await startService({ QUERY_ENGINE_DATABASE_URL: copy.engineUrl });
});
after(async () => {
  await service?.stop();
  await copy?.drop();
});

/** Runs PLAN and checks the hand-worked counts from the fixture's header; returns the time taken. */
async function timedRun(): Promise<number> {
  const started = performance.now();
  const response = await fetch(`${(service as RunningService).baseUrl}/v1/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan: PLAN }),
  });
  const body = (await response.json()) as Answer;
  const elapsed = performance.now() - started;
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.spatialPopulation, 20_000);
  assert.equal(body.recordedCount, 10_000);
  assert.equal(body.confirmedMatches, 5_000);
  return elapsed;
}

test('a run over 20,000 buildings in the view answers within 2 s before PostgreSQL has statistics on them', async () => {
  const elapsed = await timedRun();
  assert.ok(elapsed < TARGET_MS, `the run took ${Math.round(elapsed)} ms`);
});

test('a run over 20,000 buildings in the view answers within 2 s once PostgreSQL has statistics on them', async () => {
  await withClient((copy as DatabaseCopy).adminUrl, (client) => client.query('ANALYZE geometries, buildings'));
  const elapsed = await timedRun();
  assert.ok(elapsed < TARGET_MS, `the run took ${Math.round(elapsed)} ms`);
});
