// Without a test database the suite must fail loudly, never skip silently.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runNode } from './support/processes.ts';

test('npm test fails, naming the missing setting, when no test database server is configured', async () => {
  const result = await runNode(['scripts/test.ts'], {});
  assert.equal(result.code, 1);
  assert.match(result.stderr, /QUERY_ENGINE_TEST_ADMIN_URL is not set/);
});

test('a test file run on its own without the test database fails instead of skipping', async () => {
  const result = await runNode(['--test', 'test/engine-role.test.ts'], {});
  assert.notEqual(result.code, 0);
  assert.match(result.stdout, /No test database is configured/);
  assert.match(result.stdout, /ℹ skipped 0/);
});
