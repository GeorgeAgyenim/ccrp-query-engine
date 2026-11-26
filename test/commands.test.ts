// The catalogue and check commands, run as an operator runs them, and the service's refusal to
// start with a broken catalogue. colouring-core's field definitions and schema are at the commit
// pinned in scripts/core-migrations.ts; expected values are copied by hand from that commit's
// app/src/frontend/config/data-fields-config.ts and categories-config.ts.

import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { Catalogue } from '../schemas/query-engine.d.ts';
import { CORE_DEFINITIONS as CORE_DEFINITIONS_PATH } from '../scripts/core-migrations.ts';
import { migrateUp } from '../src/migrations.ts';
import { validateCatalogueShape } from '../src/schemas.ts';
import { copyOfCoreDatabase, testEnvironment, withClient, type DatabaseCopy } from './support/databases.ts';
import { runNode } from './support/processes.ts';
import { FIXTURE_CATALOGUE, freePort } from './support/service.ts';

const env = testEnvironment();
const CORE_DEFINITIONS = join(env.coreCheckout, CORE_DEFINITIONS_PATH);
/** public.buildings' columns in core's schema at the pinned commit, counted by hand in psql. */
const CORE_BUILDINGS_COLUMNS = 306;

let directory: string;
let coreCatalogueFile: string;
let coreCatalogue: Catalogue;
let catalogueOutput: string;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'query-engine-test-'));
  coreCatalogueFile = join(directory, 'core-catalogue.json');
  const result = await runNode(
    ['src/cli.ts', 'catalogue', '--definitions', CORE_DEFINITIONS, '--output', coreCatalogueFile],
    { QUERY_ENGINE_DATABASE_URL: env.mainEngineUrl },
  );
  assert.equal(result.code, 0, result.stderr);
  catalogueOutput = result.stdout;
  coreCatalogue = JSON.parse(await readFile(coreCatalogueFile, 'utf8')) as Catalogue;
});
after(() => rm(directory, { recursive: true, force: true }));

describe('catalogue command, on colouring-core', () => {
  test('writes a catalogue that follows the published catalogue format', () => {
    assert.ok(validateCatalogueShape(coreCatalogue), JSON.stringify(validateCatalogueShape.errors));
    assert.equal(coreCatalogue.formatVersion, '1.0.0');
    assert.match(catalogueOutput, /^Wrote .*core-catalogue\.json: \d+ fields in 12 categories; \d+ columns excluded/);
  });

  test("takes the categories, in core's display order, from categories-config.ts", () => {
    assert.deepEqual(coreCatalogue.categories, [
      { key: 'location', title: 'Location' },
      { key: 'land-use', title: 'Land Use & Ownership' },
      { key: 'typology-size', title: 'Form & Size' },
      { key: 'construction-design', title: 'Construction & Design' },
      { key: 'age-history', title: 'Age & History' },
      { key: 'planning-conservation', title: 'Planning & Conservation' },
      { key: 'retrofit-condition', title: 'Retrofit & Condition' },
      { key: 'energy-performance', title: 'Energy Performance & Systems' },
      { key: 'water-green-infrastructure', title: 'Green/Water Infrastructure Context' },
      { key: 'urban-infrastructure', title: 'Urban Infrastructure Context' },
      { key: 'disaster-management', title: 'Disaster Management' },
      { key: 'community', title: 'Community' },
    ]);
  });

  test("takes each field's category, title and allowed values from the definitions, and its type from the column", () => {
    const field = (key: string) => coreCatalogue.fields.find((candidate) => candidate.key === key);
    assert.deepEqual(field('building_attachment_form'), {
      key: 'building_attachment_form',
      category: 'typology-size',
      title: 'Which description best explains the way the building is attached to others?',
      type: 'text', // a PostgreSQL enum
      multiValued: false,
      allowedValues: ['Detached', 'Semi-Detached', 'End-Terrace', 'Mid-Terrace'],
      ambiguity: null,
    });
    assert.deepEqual(field('current_landuse_group'), {
      key: 'current_landuse_group',
      category: 'land-use',
      title: 'Current land use(s)',
      type: 'text',
      multiValued: true, // text[]
      allowedValues: null, // core's definition has no items
      ambiguity: null,
    });
    // A title built from the instance configuration: "Area code/" + ccconfig.postcode.
    assert.equal(field('location_postcode')?.title, 'Area code/Postcode');
    // A shared list of values: items: commonSourceTypes.
    assert.equal(field('current_landuse_source')?.allowedValues?.[0], 'Assessed by eye/personal knowledge of the building');
    assert.equal(field('current_landuse_source')?.allowedValues?.length, 15);
  });

  test('marks a column with a database default as ambiguous, naming the default', () => {
    const field = (key: string) => coreCatalogue.fields.find((candidate) => candidate.key === key);
    assert.deepEqual(field('size_storeys_core'), {
      key: 'size_storeys_core',
      category: 'construction-design',
      title: 'Core number of floors',
      type: 'integer', // smallint DEFAULT 0
      multiValued: false,
      allowedValues: null,
      ambiguity: 'The database stores 0 when nothing is entered, so a recorded 0 may not be an observation.',
    });
    assert.equal(
      field('location_subdivided')?.ambiguity,
      'The database stores false when nothing is entered, so a recorded false may not be an observation.',
    );
    // planning_conservation_area_name is varchar DEFAULT '': empty text already reads as blank.
    assert.equal(field('planning_conservation_area_name')?.ambiguity, null);
  });

  test('puts every other buildings column on the exclusion list, with its reason', () => {
    const reason = (column: string) => coreCatalogue.excludedColumns.find((entry) => entry.column === column)?.reason;
    assert.equal(reason('building_id'), 'It has no field definition.');
    assert.equal(reason('demolished_buildings'), 'Its definition describes nested values, which plan format 1 cannot query.');
    assert.equal(
      coreCatalogue.fields.length + coreCatalogue.excludedColumns.length,
      CORE_BUILDINGS_COLUMNS,
      'every column is accounted for',
    );
  });

  test('names the definitions that have no buildings column', () => {
    assert.match(catalogueOutput, /definitions have no buildings column and are not in the catalogue: uprns, planning_data/);
  });

  test('writes the same file every time', async () => {
    const again = join(directory, 'again.json');
    const result = await runNode(['src/cli.ts', 'catalogue', '--definitions', CORE_DEFINITIONS, '--output', again], {
      QUERY_ENGINE_DATABASE_URL: env.mainEngineUrl,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(again, 'utf8'), await readFile(coreCatalogueFile, 'utf8'));
  });

  /** Runs the catalogue command on a copy of core's app/src with one file changed. */
  async function catalogueOfChangedCopy(file: string, change: (source: string) => string) {
    const copy = join(directory, `src-${Math.random().toString(16).slice(2)}`);
    await cp(join(env.coreCheckout, 'app/src'), copy, { recursive: true });
    const changed = join(copy, 'frontend/config', file);
    await writeFile(changed, change(await readFile(changed, 'utf8')));
    const output = join(copy, 'catalogue.json');
    const result = await runNode(
      ['src/cli.ts', 'catalogue', '--definitions', join(copy, 'frontend/config/data-fields-config.ts'), '--output', output],
      { QUERY_ENGINE_DATABASE_URL: env.mainEngineUrl },
    );
    const written = await readFile(output, 'utf8').then(() => true, () => false);
    return { ...result, written };
  }

  test('stops, naming the file and line, at a definition it cannot read without running it', async () => {
    const result = await catalogueOfChangedCopy('data-fields-config.ts', (source) =>
      source.replace('title: "Core number of floors",', 'title: floorsTitle(),'),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /data-fields-config\.ts:\d+: the catalogue command cannot read this expression \(CallExpression\)/);
    assert.equal(result.written, false);
  });

  test('stops at a member that is not defined, rather than writing "undefined" into a title', async () => {
    const result = await catalogueOfChangedCopy('data-fields-config.ts', (source) =>
      source.replace('title: "Area code/"+ccconfig.postcode,', 'title: "Area code/"+ccconfig.postcodeLabel,'),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /data-fields-config\.ts:\d+: postcodeLabel is not defined there, so the value cannot be read\./);
    assert.equal(result.written, false);
  });

  test('writes nothing when the definitions would not give a valid catalogue, and says why', async () => {
    const result = await catalogueOfChangedCopy('categories-config.ts', (source) =>
      source.replace('    Category.Community,\n];', '    Category.Community,\n    Category.Location,\n];'),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /No catalogue was written:\n  - The catalogue made from these definitions lists category location twice\./);
    assert.equal(result.written, false);
  });
});

describe('check command', () => {
  const check = (settings: Record<string, string>) => runNode(['src/cli.ts', 'check'], settings);

  test("passes on colouring-core's schema with core's generated catalogue", async () => {
    const result = await check({ QUERY_ENGINE_DATABASE_URL: env.mainEngineUrl, QUERY_ENGINE_CATALOGUE_FILE: coreCatalogueFile });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^Check passed: .* all 306 buildings columns are fields \(\d+\) or excluded \(\d+\)/);
  });

  test("needs only the host's own schema and any login: no engine migrations, no engine login", async () => {
    const copy = await copyOfCoreDatabase(env);
    try {
      const result = await check({ QUERY_ENGINE_DATABASE_URL: copy.adminUrl, QUERY_ENGINE_CATALOGUE_FILE: coreCatalogueFile });
      assert.equal(result.code, 0, result.stderr);
    } finally {
      await copy.drop();
    }
  });

  test("fails when colouring-core's buildings layout is missing", async () => {
    const copy = await copyOfCoreDatabase(env);
    try {
      await withClient(copy.adminUrl, (client) => client.query('ALTER TABLE buildings DROP COLUMN geometry_id CASCADE'));
      const result = await check({ QUERY_ENGINE_DATABASE_URL: copy.adminUrl, QUERY_ENGINE_CATALOGUE_FILE: coreCatalogueFile });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /Table public\.buildings has no column geometry_id/);
    } finally {
      await copy.drop();
    }
  });

  test('fails when a buildings column is neither in the catalogue nor on its exclusion list', async () => {
    const copy = await migratedCopy();
    try {
      await withClient(copy.adminUrl, (client) => client.query('ALTER TABLE buildings ADD COLUMN fixture_new_detail text'));
      const result = await check({ QUERY_ENGINE_DATABASE_URL: copy.engineUrl, QUERY_ENGINE_CATALOGUE_FILE: coreCatalogueFile });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /The query engine check failed:/);
      assert.match(
        result.stderr,
        /The buildings column fixture_new_detail is neither a field in the catalogue nor on its exclusion list\./,
      );
    } finally {
      await copy.drop();
    }
  });

  test('fails when the catalogue excludes a column the database no longer has', async () => {
    const copy = await migratedCopy();
    try {
      await withClient(copy.adminUrl, (client) => client.query('ALTER TABLE buildings DROP COLUMN current_landuse_class'));
      const result = await check({ QUERY_ENGINE_DATABASE_URL: copy.engineUrl, QUERY_ENGINE_CATALOGUE_FILE: coreCatalogueFile });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /The catalogue excludes the column current_landuse_class, which public\.buildings no longer has\./);
    } finally {
      await copy.drop();
    }
  });
});

describe('start-up with the field catalogue', () => {
  async function refusal(catalogueFile: string, expected: RegExp): Promise<void> {
    const result = await runNode(
      ['src/main.ts'],
      { QUERY_ENGINE_DATABASE_URL: env.mainEngineUrl, QUERY_ENGINE_CATALOGUE_FILE: catalogueFile, QUERY_ENGINE_PORT: String(await freePort()) },
      20_000,
    );
    assert.equal(result.code, 1, `expected the service to refuse to start; it printed:\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /The query engine cannot start/);
    assert.match(result.stderr, expected);
  }

  async function fixtureWith(change: (catalogue: Catalogue) => void): Promise<string> {
    const catalogue = JSON.parse(await readFile(FIXTURE_CATALOGUE, 'utf8')) as Catalogue;
    change(catalogue);
    const file = join(directory, `catalogue-${Math.random().toString(16).slice(2)}.json`);
    await writeFile(file, JSON.stringify(catalogue));
    return file;
  }

  test('refuses to start without a catalogue setting', async () => {
    const result = await runNode(['src/main.ts'], { QUERY_ENGINE_DATABASE_URL: env.mainEngineUrl }, 20_000);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /QUERY_ENGINE_CATALOGUE_FILE is not set/);
  });

  test('refuses to start when the catalogue file cannot be read or is not JSON', async () => {
    await refusal(join(directory, 'missing.json'), /QUERY_ENGINE_CATALOGUE_FILE names a file the engine cannot read \(ENOENT\)/);
    const notJson = join(directory, 'not-json.json');
    await writeFile(notJson, 'fields: all of them');
    await refusal(notJson, /The catalogue file named by QUERY_ENGINE_CATALOGUE_FILE is not valid JSON/);
  });

  test('refuses to start when the catalogue does not follow the catalogue format', async () => {
    const file = await fixtureWith((catalogue) => {
      (catalogue.fields[0] as { type: string }).type = 'colour';
    });
    await refusal(file, /does not follow catalogue format 1\.0\.0: \/fields\/0\/type must be equal to one of the allowed values/);
  });

  test('refuses to start when a catalogue field has no buildings column', async () => {
    const file = await fixtureWith((catalogue) => {
      catalogue.fields.push({ ...(catalogue.fields[1] as Catalogue['fields'][number]), key: 'roof_colour', title: 'Roof colour' });
    });
    await refusal(file, /The catalogue lists the field roof_colour \("Roof colour"\), but public\.buildings has no such column/);
  });

  test("refuses to start when a catalogue field's type does not fit its column", async () => {
    const file = await fixtureWith((catalogue) => {
      (catalogue.fields.find((field) => field.key === 'date_year') as { type: string }).type = 'text';
    });
    await refusal(file, /The catalogue says the field date_year holds text, but the column is smallint/);
  });
});

async function migratedCopy(): Promise<DatabaseCopy> {
  const copy = await copyOfCoreDatabase(env);
  await migrateUp(copy.adminUrl);
  return copy;
}
