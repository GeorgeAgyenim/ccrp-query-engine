// The service: node src/main.ts (npm start). Reads its settings, checks the database and the
// field catalogue, then serves the HTTP API. If anything is wrong it prints why to stderr and
// exits with code 1.

import { createExecutor } from './executor.ts';
import { describeError } from './safe-log.ts';
import { buildServer } from './server.ts';
import { readSettings } from './settings.ts';
import { runStartupCheck } from './startup-check.ts';

function refuseToStart(problems: string[]): void {
  console.error(['The query engine cannot start:', ...problems.map((problem) => `  - ${problem}`)].join('\n'));
  process.exitCode = 1;
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

  const { problems, catalogue } = await runStartupCheck(executor, settings.catalogueFile, 'service');
  if (problems.length > 0 || catalogue === undefined) {
    await executor.close();
    refuseToStart(problems);
  } else {
    const app = buildServer({ executor, catalogue, statementTimeoutMs: settings.statementTimeoutMs });
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
