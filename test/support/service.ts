// Starts the real service (node src/main.ts) on a free local port.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { baseEnvironment, ROOT } from './processes.ts';

export interface RunningService {
  baseUrl: string;
  /** Everything the service has written to stdout so far (its JSON log lines). */
  stdout(): string;
  stop(): Promise<void>;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

/** Starts the service and waits until it answers. Rejects with its stderr if it exits first. */
export async function startService(env: Record<string, string>): Promise<RunningService> {
  const port = await freePort();
  const child = spawn(process.execPath, ['src/main.ts'], {
    cwd: ROOT,
    env: baseEnvironment({ QUERY_ENGINE_PORT: String(port), ...env }),
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
  const baseUrl = `http://127.0.0.1:${port}`;

  const deadline = Date.now() + 15_000;
  for (;;) {
    const code = await Promise.race([exited, new Promise<'running'>((r) => setTimeout(() => r('running'), 100))]);
    if (code !== 'running') throw new Error(`The service exited (${code}) before answering:\n${stderr}`);
    const answered = await fetch(`${baseUrl}/health`).then(() => true, () => false);
    if (answered) break;
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`The service did not answer within 15 s:\n${stderr}`);
    }
  }

  return {
    baseUrl,
    stdout: () => stdout,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await exited;
    },
  };
}
