// Operator commands. Usage:
//   node src/cli.ts migrate up       apply every pending engine migration
//   node src/cli.ts migrate down     revert the most recent engine migration
//   node src/cli.ts migrate status   list applied and pending engine migrations
//
// Migrations run with QUERY_ENGINE_MIGRATION_DATABASE_URL, a login that owns the host's
// buildings and geometries tables and can create roles. The service never uses it.
// See docs/host-setup.md.

import { connectionProblem } from './connection-problems.ts';
import { MigrationError, migrateDown, migrateUp, migrationStatus } from './migrations.ts';
import { describeError, errorCode } from './safe-log.ts';
import { MIGRATION_DATABASE_URL, readMigrationSettings } from './settings.ts';

const USAGE = 'Usage: node src/cli.ts migrate up|down|status';

async function main(args: string[]): Promise<number> {
  const [command, action] = args;
  if (command !== 'migrate' || (action !== 'up' && action !== 'down' && action !== 'status')) {
    console.error(USAGE);
    return 2;
  }
  const settings = readMigrationSettings(process.env);
  if (!settings.ok) {
    console.error(settings.problem);
    return 1;
  }

  if (action === 'up') {
    const applied = await migrateUp(settings.databaseUrl);
    console.log(applied.length === 0 ? 'Nothing to apply: the database is up to date.' : `Applied ${applied.join(', ')}.`);
  } else if (action === 'down') {
    const reverted = await migrateDown(settings.databaseUrl);
    console.log(reverted === null ? 'Nothing to revert: no engine migration is applied.' : `Reverted ${reverted}.`);
  } else {
    const status = await migrationStatus(settings.databaseUrl);
    console.log(`Applied: ${status.applied.join(', ') || 'none'}`);
    console.log(`Pending: ${status.pending.join(', ') || 'none'}`);
  }
  return 0;
}

// A failed migration statement is shown with the database's own message: it is the quickest
// way to see why, and it describes the engine's DDL, not anyone's data. A connection failure
// is shown by code only, because its message can name the login. The URL is never printed.
function explain(error: unknown): string {
  const connection = connectionProblem(error, MIGRATION_DATABASE_URL);
  if (connection !== undefined) return `Could not run the migrate command: ${connection}`;
  if (error instanceof MigrationError) {
    const cause = error.cause;
    if (cause === undefined) return error.message;
    const code = errorCode(cause);
    const detail = cause instanceof Error ? cause.message : String(cause);
    return `${error.message}\n  caused by: ${detail}${code === undefined ? '' : ` (${code})`}`;
  }
  const { name, code } = describeError(error);
  return `The migrate command failed: ${name}${code === undefined ? '' : ` (${code})`}.`;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(explain(error));
  process.exitCode = 1;
}
