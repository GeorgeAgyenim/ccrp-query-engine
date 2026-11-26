// Runs the engine's own commands (the service, the CLI) as child processes, the way an
// operator runs them, with only the environment a test gives them.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export interface ExitedProcess {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `node <args>` from the repo root and waits for it to exit (killed after `timeoutMs`). */
export function runNode(args: string[], env: Record<string, string>, timeoutMs = 30_000): Promise<ExitedProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: baseEnvironment(env) });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** PATH and HOME only, so no QUERY_ENGINE_* setting leaks in from the test runner. */
export function baseEnvironment(env: Record<string, string>): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const name of ['PATH', 'HOME']) {
    const value = process.env[name];
    if (value !== undefined) inherited[name] = value;
  }
  return { ...inherited, ...env };
}
