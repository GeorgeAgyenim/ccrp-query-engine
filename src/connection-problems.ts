// Plain sentences for an operator when the database will not take a connection. Shared by
// the service's start-up and the migrate command. The database's own message is never shown:
// it can name the login.

import { DatabaseConnectionError } from './executor.ts';
import { errorCode } from './safe-log.ts';

const REASONS: Readonly<Record<string, string>> = {
  ECONNREFUSED: 'could not reach the database server (connection refused)',
  ENOTFOUND: 'could not reach the database server (unknown host)',
  EAI_AGAIN: 'could not reach the database server (host name lookup failed)',
  ETIMEDOUT: 'could not reach the database server (timed out)',
  EHOSTUNREACH: 'could not reach the database server (host unreachable)',
  ENETUNREACH: 'could not reach the database server (network unreachable)',
  '28P01': 'the database refused the login (wrong user name or password)',
  '28000': 'the database refused the login (check pg_hba.conf)',
  '3D000': 'the database named in the URL does not exist',
  '57P03': 'the database server is starting up or shutting down',
};

/**
 * The sentence for a failed connection, or undefined when `error` is not a connection
 * failure. `setting` names the URL setting the operator should check.
 */
export function connectionProblem(error: unknown, setting: string): string | undefined {
  const code = errorCode(error);
  const reason =
    (code !== undefined ? REASONS[code] : undefined) ??
    (error instanceof DatabaseConnectionError ? 'could not reach the database server (no answer)' : undefined);
  if (reason === undefined) return undefined;
  return `${reason}${code === undefined ? '' : ` (${code})`}. Check ${setting}. See docs/host-setup.md.`;
}
