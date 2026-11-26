// schemas/query-engine.d.ts is what hosts vendor for their UIs: it must match the published
// schemas. Run `npm run types` after changing a schema.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TYPES_FILE, generateTypes } from '../scripts/generate-types.ts';

test('the committed TypeScript types file is generated from the current schemas', () => {
  assert.equal(readFileSync(TYPES_FILE, 'utf8'), generateTypes(), 'schemas/query-engine.d.ts is out of date: run `npm run types`');
});

test("the types file's header names the engine, plan format and catalogue format versions", () => {
  const [, versions] = readFileSync(TYPES_FILE, 'utf8').split('\n');
  assert.equal(versions, '// ccrp-query-engine 0.1.0: plan format 1.0.0, catalogue format 1.0.0, API v1.');
});
