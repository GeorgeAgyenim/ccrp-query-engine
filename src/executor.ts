// The executor: the engine's only path to the database.
//
// Every read runs in one READ ONLY transaction, with the statement timeout set inside that
// transaction, whatever defaults the login or the database have. The connection should be
// the engine's own login, granted the no-login group role query_engine_reader
// (docs/decisions/0001-queries-run-in-postgis-under-a-narrow-read-only-role.md); the
// start-up check refuses a login that can see more.
//
// Callers pass trusted SQL text (written in this repository, later only compiler output)
// with values as parameters, never interpolated. Three layers keep a statement read-only and
// time-limited:
//  - statements go over PostgreSQL's extended protocol, which carries one statement at a time,
//    so a text cannot append a second statement;
//  - each connection starts read-only with the timeout as its session default, so a statement
//    that ends the transaction early (COMMIT) still cannot write or run unbounded;
//  - the engine role has no write privilege anywhere (ADR-0007).
// A caller could still change the session settings themselves (SET ...): only trusted SQL may
// reach the executor.

import pg from 'pg';
import { EngineError, errorCode } from './safe-log.ts';

export type Row = Record<string, unknown>;

export type Query = <R extends Row = Row>(sql: string, params?: readonly unknown[]) => Promise<R[]>;

export interface Executor {
  /** Runs `work` in one read-only transaction with the statement timeout set. */
  read<T>(work: (query: Query) => Promise<T>): Promise<T>;
  /** Closes every connection. Reads after this fail. */
  close(): Promise<void>;
}

export interface ExecutorOptions {
  databaseUrl: string;
  statementTimeoutMs: number;
}

/** How long to wait for the database to accept a connection before giving up. */
export const CONNECT_TIMEOUT_MS = 5_000;

/** A statement ran longer than the statement timeout and PostgreSQL cancelled it. */
export class QueryTimeoutError extends EngineError {
  override name = 'QueryTimeoutError';
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`The query took longer than the ${timeoutMs} ms statement timeout and was cancelled`);
    this.timeoutMs = timeoutMs;
  }
}

/** The database did not accept a connection: unreachable, refused the login, or no such database. */
export class DatabaseConnectionError extends EngineError {
  override name = 'DatabaseConnectionError';
  /** The cause's code (ECONNREFUSED, 28P01, ...); absent when the connection timed out. */
  readonly code: string | undefined;
  constructor(cause: unknown) {
    super('Could not connect to the database', { cause });
    this.code = errorCode(cause);
  }
}

// PostgreSQL's query_canceled. It is also the code when an operator cancels a backend by
// hand; the engine cancels nothing itself, so here it means the timeout.
const QUERY_CANCELED = '57014';

export function createExecutor(options: ExecutorOptions): Executor {
  const timeout = String(options.statementTimeoutMs);
  const pool = new pg.Pool({
    connectionString: options.databaseUrl,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    // Session defaults for every connection, sent when it opens (both values are integers we hold).
    options: `-c default_transaction_read_only=on -c statement_timeout=${timeout}`,
  });
  // An idle connection that fails (the server restarted, say) is dropped from the pool;
  // without a listener the error would end the process.
  pool.on('error', () => {});

  return {
    async read(work) {
      const client = await pool.connect().catch((error: unknown) => {
        throw new DatabaseConnectionError(error);
      });
      let healthy = true;
      try {
        await client.query('BEGIN TRANSACTION READ ONLY');
        // set_config(..., true) is SET LOCAL with a parameter: it lasts until the transaction ends.
        await client.query("SELECT set_config('statement_timeout', $1, true)", [timeout]);
        const query: Query = async <R extends Row>(sql: string, params: readonly unknown[] = []) => {
          const config = { text: sql, values: [...params], queryMode: 'extended' };
          const result = await client.query<R>(config);
          return result.rows;
        };
        const value = await work(query);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {
          healthy = false;
        });
        if (errorCode(error) === QUERY_CANCELED) {
          throw new QueryTimeoutError(options.statementTimeoutMs);
        }
        throw error;
      } finally {
        client.release(healthy ? undefined : true);
      }
    },
    async close() {
      await pool.end();
    },
  };
}
