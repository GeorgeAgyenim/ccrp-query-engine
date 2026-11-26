// The engine's own database migrations: numbered SQL files in migrations/, each with
// an up and a down. Applied ids are recorded in query_engine.migrations, which
// migration 001 creates. See docs/decisions/0007-engine-schema-role-and-migrations.md.

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../migrations/', import.meta.url));

// Any fixed number works; it only has to be the same for every run of the migrate command.
const MIGRATION_LOCK_KEY = 7_302_001;

export interface Migration {
  id: string;
  upFile: string;
  downFile: string;
}

export class MigrationError extends Error {
  override name = 'MigrationError';
}

/** The migrations this engine version ships, in the order they apply. */
export async function listMigrations(directory = MIGRATIONS_DIRECTORY): Promise<Migration[]> {
  const files = await readdir(directory);
  const ups = files.filter((file) => file.endsWith('.up.sql')).sort();
  return ups.map((upFile) => {
    const id = upFile.slice(0, -'.up.sql'.length);
    if (!/^\d{3}\.[a-z0-9-]+$/.test(id)) {
      throw new MigrationError(`Migration file ${upFile} is not named NNN.lower-case-words.up.sql`);
    }
    const downFile = `${id}.down.sql`;
    if (!files.includes(downFile)) {
      throw new MigrationError(`Migration ${id} has no ${downFile}`);
    }
    return { id, upFile: `${directory}${upFile}`, downFile: `${directory}${downFile}` };
  });
}

export interface MigrationComparison {
  /** Shipped with this engine but not yet applied to the database. */
  pending: string[];
  /** Applied to the database but not shipped with this engine (a newer engine migrated it). */
  unknown: string[];
}

export function compareMigrations(applied: readonly string[], shipped: readonly string[]): MigrationComparison {
  return {
    pending: shipped.filter((id) => !applied.includes(id)),
    unknown: applied.filter((id) => !shipped.includes(id)),
  };
}

/** Ids recorded as applied, oldest first; empty when migration 001 has not run. */
export async function readAppliedMigrations(
  query: (sql: string) => Promise<Array<Record<string, unknown>>>,
): Promise<string[]> {
  const [table] = await query(`SELECT to_regclass('query_engine.migrations') IS NOT NULL AS present`);
  if (table?.['present'] !== true) return [];
  const rows = await query('SELECT id FROM query_engine.migrations ORDER BY id');
  return rows.map((row) => String(row['id']));
}

export interface MigrationStatus {
  applied: string[];
  pending: string[];
}

export async function migrationStatus(databaseUrl: string): Promise<MigrationStatus> {
  return withClient(databaseUrl, async (client) => {
    const shipped = await listMigrations();
    const applied = await readAppliedMigrations(rowsOf(client));
    assertConsistent(applied, shipped);
    return { applied, pending: compareMigrations(applied, shipped.map((m) => m.id)).pending };
  });
}

/** Applies every pending migration, each in its own transaction. Returns the ids applied. */
export async function migrateUp(databaseUrl: string): Promise<string[]> {
  return withMigrationLock(databaseUrl, async (client) => {
    const shipped = await listMigrations();
    const applied = await readAppliedMigrations(rowsOf(client));
    assertConsistent(applied, shipped);
    const done: string[] = [];
    for (const migration of shipped.slice(applied.length)) {
      const sql = await readFile(migration.upFile, 'utf8');
      await inTransaction(client, migration.id, async () => {
        await client.query(sql);
        await client.query('INSERT INTO query_engine.migrations (id) VALUES ($1)', [migration.id]);
      });
      done.push(migration.id);
    }
    return done;
  });
}

/** Reverts the most recently applied migration. Returns its id, or null when none is applied. */
export async function migrateDown(databaseUrl: string): Promise<string | null> {
  return withMigrationLock(databaseUrl, async (client) => {
    const shipped = await listMigrations();
    const applied = await readAppliedMigrations(rowsOf(client));
    assertConsistent(applied, shipped);
    const latest = applied.at(-1);
    if (latest === undefined) return null;
    const migration = shipped.find((m) => m.id === latest);
    if (migration === undefined) throw new MigrationError(`Migration ${latest} is not shipped`);
    const sql = await readFile(migration.downFile, 'utf8');
    await inTransaction(client, latest, async () => {
      await client.query('DELETE FROM query_engine.migrations WHERE id = $1', [latest]);
      await client.query(sql);
    });
    return latest;
  });
}

function assertConsistent(applied: readonly string[], shipped: readonly Migration[]): void {
  applied.forEach((id, index) => {
    if (shipped[index]?.id !== id) {
      throw new MigrationError(
        `The database records engine migration ${id}, which this engine version does not ship in that position. ` +
          'A newer engine version may have migrated it; run that version instead.',
      );
    }
  });
}

async function inTransaction(client: pg.Client, id: string, work: () => Promise<void>): Promise<void> {
  await client.query('BEGIN');
  try {
    await work();
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw new MigrationError(`Migration ${id} failed and was rolled back; nothing from it was applied`, {
      cause: error,
    });
  }
}

async function withMigrationLock<T>(databaseUrl: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  return withClient(databaseUrl, async (client) => {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      return await work(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  });
}

async function withClient<T>(databaseUrl: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

function rowsOf(client: pg.Client) {
  return async (sql: string) => (await client.query(sql)).rows as Array<Record<string, unknown>>;
}
