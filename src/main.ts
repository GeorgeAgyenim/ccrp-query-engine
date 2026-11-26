// The service: node src/main.ts (npm start). Reads its settings, checks the database, then
// serves the HTTP API. If anything is wrong it prints why to stderr and exits with code 1.

import { connectionProblem } from './connection-problems.ts';
import { createExecutor } from './executor.ts';
import { checkDatabase } from './layout-check.ts';
import { describeError } from './safe-log.ts';
import { buildServer } from './server.ts';
import { readSettings, SETTING_NAMES } from './settings.ts';

function refuseToStart(problems: string[]): void {
  console.error(['The query engine cannot start:', ...problems.map((problem) => `  - ${problem}`)].join('\n'));
  process.exitCode = 1;
}

// A failure of the check itself, described the way logs describe errors: by name and code,
// with the message only for the engine's own errors.
function checkFailure(error: unknown): string {
  const connection = connectionProblem(error, SETTING_NAMES.databaseUrl);
  if (connection !== undefined) return connection;
  const { name, code, message } = describeError(error);
  return (
    `the start-up check could not finish: ${name}${code === undefined ? '' : ` (${code})`}` +
    `${message === undefined ? '' : `: ${message}`}. See docs/host-setup.md.`
  );
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
    problems = [checkFailure(error)];
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
