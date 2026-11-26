// The executor: the engine's only path to the database.
//
// Every read runs in one READ ONLY transaction, with the statement timeout set inside that
// transaction, whatever defaults the login or the database have. The connection should be
// the engine's own login, granted the no-login group role query_engine_reader
// (docs/decisions/0001-queries-run-in-postgis-under-a-narrow-read-only-role.md); the
// start-up check refuses a login that can see more.
//
// Callers pass trusted SQL text (written in this repository, later only compiler output)
// with values as parameters, never interpolated. Statements go over PostgreSQL's extended
// protocol, which carries one statement at a time, so a text cannot add a second statement.

import pg from 'pg';
import { EngineError } from './safe-log.ts';

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

/** A statement ran longer than the statement timeout and PostgreSQL cancelled it. */
export class QueryTimeoutError extends EngineError {
  override name = 'QueryTimeoutError';
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`The query took longer than the ${timeoutMs} ms statement timeout and was cancelled`);
    this.timeoutMs = timeoutMs;
  }
}

// PostgreSQL's query_canceled. It is also the code when an operator cancels a backend by
// hand; the engine cancels nothing itself, so here it means the timeout.
const QUERY_CANCELED = '57014';

export function createExecutor(options: ExecutorOptions): Executor {
  const pool = new pg.Pool({ connectionString: options.databaseUrl });
  // An idle connection that fails (the server restarted, say) is dropped from the pool;
  // without a listener the error would end the process.
  pool.on('error', () => {});

  return {
    async read(work) {
      const client = await pool.connect();
      let healthy = true;
      try {
        await client.query('BEGIN TRANSACTION READ ONLY');
        // set_config(..., true) is SET LOCAL with a parameter: it lasts until the transaction ends.
        await client.query("SELECT set_config('statement_timeout', $1, true)", [String(options.statementTimeoutMs)]);
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
        if ((error as { code?: unknown }).code === QUERY_CANCELED) {
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
