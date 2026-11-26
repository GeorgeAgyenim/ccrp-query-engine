// The engine's settings, read from its environment. Names and defaults are documented in
// docs/host-setup.md#settings; keep the two in step. The database URLs, which hold
// credentials, are never logged or printed.

export interface Settings {
  /** PostgreSQL URL of the engine's own login. Point it at a database copy to query the copy. */
  databaseUrl: string;
  /** Statement timeout set inside every engine transaction, in milliseconds. */
  statementTimeoutMs: number;
  /** Interface the HTTP server listens on. */
  host: string;
  /** Port the HTTP server listens on. */
  port: number;
}

export const SETTING_NAMES = {
  databaseUrl: 'QUERY_ENGINE_DATABASE_URL',
  statementTimeoutMs: 'QUERY_ENGINE_STATEMENT_TIMEOUT_MS',
  host: 'QUERY_ENGINE_HOST',
  port: 'QUERY_ENGINE_PORT',
} as const satisfies Record<keyof Settings, string>;

/** Read only by the migrate command: the database owner's login, which the service never holds. */
export const MIGRATION_DATABASE_URL = 'QUERY_ENGINE_MIGRATION_DATABASE_URL';

export type MigrationSettingsResult = { ok: true; databaseUrl: string } | { ok: false; problem: string };

export function readMigrationSettings(env: Record<string, string | undefined>): MigrationSettingsResult {
  const databaseUrl = env[MIGRATION_DATABASE_URL] ?? '';
  if (databaseUrl === '') {
    return {
      ok: false,
      problem:
        `${MIGRATION_DATABASE_URL} is not set. Set it to a postgres:// URL for a login that owns the host's ` +
        'buildings and geometries tables and can create roles (see docs/host-setup.md).',
    };
  }
  if (!isPostgresUrl(databaseUrl)) {
    return { ok: false, problem: `${MIGRATION_DATABASE_URL} is not a postgres:// or postgresql:// URL.` };
  }
  return { ok: true, databaseUrl };
}

export const DEFAULT_STATEMENT_TIMEOUT_MS = 10_000;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 3100;

// PostgreSQL's largest statement_timeout.
const MAX_TIMEOUT_MS = 2_147_483_647;

export type SettingsResult = { ok: true; settings: Settings } | { ok: false; problems: string[] };

/** Reads and checks every setting; reports every problem at once, never a value. */
export function readSettings(env: Record<string, string | undefined>): SettingsResult {
  const problems: string[] = [];

  const databaseUrl = env[SETTING_NAMES.databaseUrl] ?? '';
  if (databaseUrl === '') {
    problems.push(
      `${SETTING_NAMES.databaseUrl} is not set. Set it to a postgres:// URL for the engine's own login.`,
    );
  } else if (!isPostgresUrl(databaseUrl)) {
    problems.push(`${SETTING_NAMES.databaseUrl} is not a postgres:// or postgresql:// URL.`);
  }

  const statementTimeoutMs = wholeNumber(env[SETTING_NAMES.statementTimeoutMs], DEFAULT_STATEMENT_TIMEOUT_MS);
  if (statementTimeoutMs === undefined || statementTimeoutMs < 1 || statementTimeoutMs > MAX_TIMEOUT_MS) {
    problems.push(
      `${SETTING_NAMES.statementTimeoutMs} must be a whole number of milliseconds from 1 to ${MAX_TIMEOUT_MS}.`,
    );
  }

  const port = wholeNumber(env[SETTING_NAMES.port], DEFAULT_PORT);
  if (port === undefined || port > 65_535) {
    problems.push(`${SETTING_NAMES.port} must be a port number from 0 to 65535.`);
  }

  const host = env[SETTING_NAMES.host] || DEFAULT_HOST;

  if (problems.length > 0 || statementTimeoutMs === undefined || port === undefined) {
    return { ok: false, problems };
  }
  return { ok: true, settings: { databaseUrl, statementTimeoutMs, host, port } };
}

function isPostgresUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'postgres:' || protocol === 'postgresql:';
  } catch {
    return false;
  }
}

function wholeNumber(value: string | undefined, fallback: number): number | undefined {
  if (value === undefined || value === '') return fallback;
  return /^\d+$/.test(value) ? Number(value) : undefined;
}
