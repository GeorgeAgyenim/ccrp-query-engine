// Operator commands. Usage:
//   node src/cli.ts migrate up       apply every pending engine migration
//   node src/cli.ts migrate down     revert the most recent engine migration
//   node src/cli.ts migrate status   list applied and pending engine migrations
//
// Migrations run with QUERY_ENGINE_MIGRATION_DATABASE_URL, a login that owns the host's
// buildings and geometries tables and can create roles. The service never uses it.
// See docs/host-setup.md.

import { MigrationError, migrateDown, migrateUp, migrationStatus } from './migrations.ts';

const MIGRATION_URL = 'QUERY_ENGINE_MIGRATION_DATABASE_URL';
const USAGE = 'Usage: node src/cli.ts migrate up|down|status';

async function main(args: string[]): Promise<number> {
  const [command, action] = args;
  if (command !== 'migrate' || (action !== 'up' && action !== 'down' && action !== 'status')) {
    console.error(USAGE);
    return 2;
  }
  const databaseUrl = process.env[MIGRATION_URL];
  if (!databaseUrl) {
    console.error(
      `${MIGRATION_URL} is not set. Set it to a PostgreSQL URL for a login that owns the host's ` +
        'buildings and geometries tables and can create roles (see docs/host-setup.md).',
    );
    return 1;
  }

  if (action === 'up') {
    const applied = await migrateUp(databaseUrl);
    console.log(applied.length === 0 ? 'Nothing to apply: the database is up to date.' : `Applied ${applied.join(', ')}.`);
  } else if (action === 'down') {
    const reverted = await migrateDown(databaseUrl);
    console.log(reverted === null ? 'Nothing to revert: no engine migration is applied.' : `Reverted ${reverted}.`);
  } else {
    const status = await migrationStatus(databaseUrl);
    console.log(`Applied: ${status.applied.join(', ') || 'none'}`);
    console.log(`Pending: ${status.pending.join(', ') || 'none'}`);
  }
  return 0;
}

// The operator's own terminal, so the database's message is shown: it is the quickest way to
// see why a migration failed. Migrations carry no personal data. The URL is never printed.
function explain(error: unknown): string {
  const lines: string[] = [];
  for (let current = error; current instanceof Error; current = current.cause) {
    const code = (current as { code?: unknown }).code;
    lines.push(typeof code === 'string' ? `${current.message} (${code})` : current.message);
    if (!(current instanceof MigrationError)) break;
  }
  return lines.join('\n  caused by: ') || String(error);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(explain(error));
  process.exitCode = 1;
}
