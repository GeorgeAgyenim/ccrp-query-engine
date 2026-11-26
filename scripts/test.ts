// The one test command (`npm test`). It:
//  1. creates a throwaway database and applies colouring-core's migrations at the pinned commit;
//  2. copies it to the main test database and applies the engine's migrations;
//  3. creates a test login granted the engine's group role, and loads the named fixtures;
//  4. runs the suite with node:test; then
//  5. drops every database it created and the test login, whether the suite passed or not.
//
// It needs QUERY_ENGINE_TEST_ADMIN_URL: a superuser URL for a disposable PostGIS server's
// maintenance database. Without it the command fails; it never skips the suite.
//
// Usage: npm test [-- test/some-file.test.ts ...]

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { migrateUp } from '../src/migrations.ts';
import {
  CORE_COMMIT,
  CORE_EXTENSIONS,
  CORE_REPOSITORY,
  applyCoreMigrations,
  fetchCoreMigrations,
} from './core-migrations.ts';
import {
  TEST_VARIABLES,
  createDatabase,
  dropDatabase,
  onDatabase,
  withClient,
} from '../test/support/databases.ts';

// Loaded in this order into the main test database. Each is test/fixtures/<name>.sql.
const FIXTURES = ['buildings', 'host-private-tables'];

const root = fileURLToPath(new URL('../', import.meta.url));

const serverAdminUrl = process.env[TEST_VARIABLES.serverAdminUrl];
if (!serverAdminUrl) {
  console.error(
    `${TEST_VARIABLES.serverAdminUrl} is not set, so there is no test database and the suite cannot run.\n` +
      'Set it to a superuser URL for a disposable PostGIS server, for example\n' +
      `  ${TEST_VARIABLES.serverAdminUrl}=postgres://postgres@127.0.0.1:5432/postgres npm test\n` +
      'README.md shows how to start one with Docker.',
  );
  process.exit(1);
}

const runId = `qe_test_${randomBytes(4).toString('hex')}`;
const coreTemplate = `${runId}_core`;
const mainDatabase = `${runId}_main`;
const login = `${runId}_login`;
const password = randomBytes(24).toString('base64url');

let interrupted = false;
let suite: ReturnType<typeof spawn> | undefined;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    interrupted = true;
    suite?.kill(signal);
  });
}

let exitCode = 1;
try {
  const started = Date.now();
  const coreMigrations = await fetchCoreMigrations({
    repository: process.env['QUERY_ENGINE_TEST_CORE_REPOSITORY'] || CORE_REPOSITORY,
    commit: CORE_COMMIT,
    cacheRoot: `${root}.cache`,
  });

  await createDatabase(serverAdminUrl, coreTemplate);
  const coreAdminUrl = onDatabase(serverAdminUrl, coreTemplate);
  await withClient(coreAdminUrl, async (client) => {
    for (const extension of CORE_EXTENSIONS) {
      await client.query(`CREATE EXTENSION IF NOT EXISTS ${client.escapeIdentifier(extension)}`);
    }
  });
  const coreFiles = await applyCoreMigrations(coreMigrations, coreAdminUrl);

  await createDatabase(serverAdminUrl, mainDatabase, coreTemplate);
  const adminUrl = onDatabase(serverAdminUrl, mainDatabase);
  const engineMigrations = await migrateUp(adminUrl);

  await withClient(serverAdminUrl, async (client) => {
    const role = client.escapeIdentifier(login);
    // CREATE ROLE takes no parameters; the name and password are generated above.
    await client.query(`CREATE ROLE ${role} LOGIN PASSWORD ${client.escapeLiteral(password)}`);
    await client.query(`GRANT query_engine_reader TO ${role}`);
    // A long role-level timeout, so the tests prove the engine sets its own in each transaction.
    await client.query(`ALTER ROLE ${role} SET statement_timeout = '1h'`);
  });
  const engineUrl = new URL(adminUrl);
  engineUrl.username = encodeURIComponent(login);
  engineUrl.password = encodeURIComponent(password);

  await withClient(adminUrl, async (client) => {
    for (const fixture of FIXTURES) {
      const sql = await readFile(`${root}test/fixtures/${fixture}.sql`, 'utf8');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
    }
  });

  console.log(
    `Test database ready in ${((Date.now() - started) / 1000).toFixed(1)} s: colouring-core ${CORE_COMMIT.slice(0, 8)} ` +
      `(${coreFiles} migrations), engine migrations ${engineMigrations.join(', ')}, fixtures ${FIXTURES.join(', ')}.`,
  );

  if (!interrupted) {
    const files = process.argv.slice(2);
    suite = spawn(
      process.execPath,
      ['--test', '--test-concurrency=1', ...(files.length > 0 ? files : ['test/**/*.test.ts'])],
      {
        cwd: root,
        stdio: 'inherit',
        env: {
          ...process.env,
          [TEST_VARIABLES.adminUrl]: adminUrl,
          [TEST_VARIABLES.engineUrl]: engineUrl.toString(),
          [TEST_VARIABLES.coreTemplate]: coreTemplate,
          [TEST_VARIABLES.runId]: runId,
        },
      },
    );
    const child = suite;
    exitCode = await new Promise<number>((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
  }
} catch (error) {
  console.error('The test database could not be built:');
  console.error(error);
} finally {
  await withClient(serverAdminUrl, async (client) => {
    const { rows } = await client.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE starts_with(datname, $1)',
      [runId],
    );
    for (const { datname } of rows) await dropDatabase(serverAdminUrl, datname);
    await client.query(`DROP ROLE IF EXISTS ${client.escapeIdentifier(login)}`);
  }).catch((error: unknown) => {
    console.error(`Could not drop the test databases starting ${runId}:`, error);
    exitCode = 1;
  });
}
process.exitCode = interrupted ? 130 : exitCode;
