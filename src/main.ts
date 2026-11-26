// The service: node src/main.ts (npm start). Reads its settings, checks the database, then
// serves the HTTP API. If anything is wrong it prints why to stderr and exits with code 1.

import { createExecutor } from './executor.ts';
import { checkDatabase } from './layout-check.ts';
import { describeError } from './safe-log.ts';
import { buildServer } from './server.ts';
import { readSettings } from './settings.ts';

function refuseToStart(problems: string[]): void {
  console.error(['The query engine cannot start:', ...problems.map((problem) => `  - ${problem}`)].join('\n'));
  process.exitCode = 1;
}

// Connection failures, by code. The database's own message is not printed: it can name the login.
function connectionProblem(error: unknown): string {
  const code = describeError(error).code ?? 'no code';
  const reasons: Record<string, string> = {
    ECONNREFUSED: 'could not reach the database server',
    ENOTFOUND: 'could not reach the database server (unknown host)',
    ETIMEDOUT: 'could not reach the database server (timed out)',
    EHOSTUNREACH: 'could not reach the database server',
    '28P01': 'the database refused the login (wrong user name or password)',
    '28000': 'the database refused the login',
    '3D000': 'the database named in the URL does not exist',
  };
  const reason = reasons[code] ?? 'could not query the database';
  return `${reason} (${code}). Check QUERY_ENGINE_DATABASE_URL. See docs/host-setup.md.`;
}

const result = readSettings(process.env);
if (!result.ok) {
  refuseToStart(result.problems);
} else {
  const { settings } = result;
  const executor = createExecutor({
    databaseUrl: settings.databaseUrl,
    statementTimeoutMs: settings.statementTimeoutMs,
  });

  let problems: string[];
  try {
    problems = await checkDatabase(executor);
  } catch (error) {
    problems = [connectionProblem(error)];
  }

  if (problems.length > 0) {
    await executor.close();
    refuseToStart(problems);
  } else {
    const app = buildServer({ executor });
    const shutDown = async () => {
      await app.close();
      await executor.close();
    };
    process.once('SIGTERM', shutDown);
    process.once('SIGINT', shutDown);
    try {
      await app.listen({ host: settings.host, port: settings.port });
    } catch (error) {
      await executor.close();
      refuseToStart([`could not listen on ${settings.host}:${settings.port} (${describeError(error).code ?? 'no code'}).`]);
    }
  }
}
