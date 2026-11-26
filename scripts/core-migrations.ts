// colouring-core's database migrations at a pinned commit: fetched with git into
// .cache/ and applied the way core's migrations/README.md applies them.
//
// When you change CORE_COMMIT, update docs/tools-inventory.md in the same commit.

import { execFile } from 'node:child_process';
import { access, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const CORE_REPOSITORY = 'https://github.com/colouring-cities/colouring-core.git';
export const CORE_COMMIT = 'cd5fc563255aa06c01044c0c7d411878ac1d3124';

// Extensions core's README says to create by hand before the migrations.
export const CORE_EXTENSIONS = ['postgis', 'pgcrypto', 'pg_trgm'];

// Errors core's own procedure meets and steps over. Core runs each file with psql
// without ON_ERROR_STOP, so a failing statement is reported and the rest of the file
// still applies. Any error not listed here stops the test command.
const EXPECTED_ERRORS: ReadonlyArray<{ file: string; sqlstate: string; why: string }> = [
  {
    file: '007.date-details.up.sql',
    sqlstate: '42710',
    why: 're-adds constraint buildings_date_source_detail_len, which 004 already created',
  },
];

/** Fetches core's migrations at `commit` (once; later runs reuse the cache). Returns their directory. */
export async function fetchCoreMigrations(options: {
  repository: string;
  commit: string;
  cacheRoot: string;
}): Promise<string> {
  const checkout = join(options.cacheRoot, 'colouring-core', options.commit);
  const migrations = join(checkout, 'migrations');
  if (await checkedOutAt(checkout, options.commit)) return migrations;

  await rm(checkout, { recursive: true, force: true });
  await mkdir(checkout, { recursive: true });
  const git = (...args: string[]) => run('git', ['-C', checkout, ...args]);
  await git('init', '--quiet');
  await git('sparse-checkout', 'set', 'migrations');
  await git('fetch', '--quiet', '--depth', '1', '--filter=blob:none', options.repository, options.commit);
  await git('-c', 'advice.detachedHead=false', 'checkout', '--quiet', 'FETCH_HEAD');
  if (!(await checkedOutAt(checkout, options.commit))) {
    throw new Error(`Fetched colouring-core but HEAD is not ${options.commit}`);
  }
  return migrations;
}

async function checkedOutAt(checkout: string, commit: string): Promise<boolean> {
  try {
    await access(join(checkout, 'migrations'));
    const { stdout } = await run('git', ['-C', checkout, 'rev-parse', 'HEAD']);
    return stdout.trim() === commit;
  } catch {
    return false;
  }
}

/**
 * Applies every `*.up.sql` directly in `directory`, in byte order, with psql, as core's
 * README does. Throws if psql reports an error that is not in EXPECTED_ERRORS.
 */
export async function applyCoreMigrations(directory: string, databaseUrl: string): Promise<number> {
  const files = (await readdir(directory)).filter((file) => file.endsWith('.up.sql')).sort();
  const unexpected: string[] = [];
  for (const file of files) {
    const { stderr } = await run(
      'psql',
      ['--no-psqlrc', '--quiet', '-v', 'ON_ERROR_STOP=0', '-v', 'VERBOSITY=verbose', '-f', join(directory, file)],
      { env: { ...process.env, ...psqlEnvironment(databaseUrl) }, maxBuffer: 16 * 1024 * 1024 },
    );
    for (const line of stderr.split('\n')) {
      const error = /ERROR:\s+([0-9A-Z]{5}):/.exec(line);
      if (error === null) continue;
      const expected = EXPECTED_ERRORS.some((e) => e.file === file && e.sqlstate === error[1]);
      if (!expected) unexpected.push(line.trim());
    }
  }
  if (unexpected.length > 0) {
    throw new Error(`colouring-core migrations failed:\n${unexpected.join('\n')}`);
  }
  return files.length;
}

// psql reads the connection from PG* variables, which keeps the password off the command line.
function psqlEnvironment(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  const env: Record<string, string> = {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode !== null) env['PGSSLMODE'] = sslmode;
  return env;
}
