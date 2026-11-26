// The query API over HTTP: the real service on the main test database, reading the fixture
// catalogue (test/fixtures/catalogue.json) and the buildings in test/fixtures/count-in-view.sql.
// Expected counts are worked out by hand from the tables in that fixture's header.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import type { Answer, Condition, InvalidResponse, Plan, PlanProblem } from '../schemas/query-engine.d.ts';
import { apiValidator } from '../src/schemas.ts';
import { testEnvironment } from './support/databases.ts';
import { startService, type RunningService } from './support/service.ts';

const env = testEnvironment();

/** The fixture's test view: x 0 to 100.19 m, y 100.19 to 200.38 m in EPSG:3857. */
const VIEW: Plan['area'] = { type: 'viewport', bbox: [0, 0.0009, 0.0009, 0.0018] };

const property = (key: string) => ({ property: key });
const LAND_USE = property('current_landuse_group');
const MATERIAL = property('construction_core_material');
const YEAR = property('date_year');
const STOREYS = property('size_storeys_core');
const TYPOLOGY = property('typology_classification');
const STREET = property('location_street');
const HEIGHT = property('size_height_apex');

function planOf(...filters: Condition[]): Plan {
  return {
    version: '1.0.0',
    area: VIEW,
    steps: filters.map((filter) => ({ type: 'filter', filter })),
    outputs: [{ type: 'number' }],
  };
}

let service: RunningService;
before(async () => {
  service = await startService({ QUERY_ENGINE_DATABASE_URL: env.mainEngineUrl });
});
after(() => service.stop());

async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const init: RequestInit =
    body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const response = await fetch(`${service.baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

/** Asserts `body` follows the published API schema's `name` definition. */
function assertFollowsSchema(body: unknown, name: string): void {
  const validate = apiValidator(name);
  assert.ok(validate(body), `the body follows ${name}: ${JSON.stringify(validate.errors)}`);
}

async function run(plan: unknown): Promise<Answer> {
  const response = await call('POST', '/v1/run', { plan });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assertFollowsSchema(response.body, 'RunResponse');
  return response.body as Answer;
}

/** The sentence after its "As of <time> — ", checking that time against asOf. */
function sentenceAfterAsOf(answer: Answer): string {
  const match = /^As of (\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2} UTC) — (.*)$/.exec(answer.sentence);
  assert.ok(match, `the sentence starts with its "as of" time: ${answer.sentence}`);
  const shown = Date.parse(match[1] as string);
  assert.ok(Math.abs(shown - Date.parse(answer.asOf)) < 60_000, 'the sentence shows the answer\'s asOf, to the minute');
  return match[2] as string;
}

describe('GET /v1/catalogue', () => {
  test('lists the fields by category, with types and allowed values, including values nobody has recorded', async () => {
    const response = await call('GET', '/v1/catalogue');
    assert.equal(response.status, 200);
    assertFollowsSchema(response.body, 'CatalogueResponse');
    const body = response.body as { formatVersion: string; categories: Array<{ key: string; fields: Array<{ key: string }> }> };
    assert.equal(body.formatVersion, '1.0.0');
    assert.deepEqual(
      body.categories.map((category) => [category.key, category.fields.map((field) => field.key)]),
      [
        ['land-use', ['current_landuse_group']],
        ['construction', ['construction_core_material', 'size_storeys_core', 'typology_classification', 'size_height_apex']],
        ['age', ['date_year']],
        ['location', ['location_street']],
        ['community', []],
      ],
    );
    assert.deepEqual(body.categories[0], {
      key: 'land-use',
      title: 'Land use',
      fields: [
        {
          key: 'current_landuse_group',
          category: 'land-use',
          title: 'Land use',
          type: 'text',
          multiValued: true,
          // No fixture building is recorded as Agriculture.
          allowedValues: ['Residential', 'Retail', 'Industry', 'Agriculture'],
          ambiguity: null,
        },
      ],
    });
  });
});

describe('GET /v1/plan-schema', () => {
  test('returns the JSON Schema of the plan format this engine runs', async () => {
    const response = await call('GET', '/v1/plan-schema');
    assert.equal(response.status, 200);
    const schema = response.body as { $id: string; $schema: string; properties: { version: { enum: string[] } } };
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.$id, 'urn:ccrp-query-engine:schema:plan:1.0.0');
    assert.deepEqual(schema.properties.version.enum, ['1.0.0']);
    assert.deepEqual(schema, JSON.parse(readFileSync(new URL('../schemas/plan-1.schema.json', import.meta.url), 'utf8')));
  });
});

describe('POST /v1/run: placing buildings in the view', () => {
  test('counts every mapped building whose point on surface is in the view when there are no conditions', async () => {
    const answer = await run(planOf());
    // 900101-900106, 900109, 900111 and 900113.
    assert.equal(answer.spatialPopulation, 9);
    assert.equal(answer.recordedCount, 9);
    assert.equal(answer.confirmedMatches, 9);
    assert.deepEqual(answer.share, { numerator: 9, denominator: 9, value: 1, isUndefined: false, undefinedReason: null });
    assert.deepEqual(answer.fields, []);
    assert.equal(sentenceAfterAsOf(answer), 'there are 9 mapped buildings in this view.');
  });

  const placements: Array<{ name: string; year: number; matches: number }> = [
    { name: 'a footprint inside the view', year: 1960, matches: 1 }, // 900105
    { name: 'footprints entirely outside the view', year: 1950, matches: 1 }, // 900101 in; 900107, 900108 out
    { name: 'a footprint crossing the east edge with its point on surface inside', year: 1990, matches: 1 }, // 900109
    { name: 'a footprint crossing the east edge with its point on surface outside', year: 1991, matches: 0 }, // 900110
    { name: 'a footprint whose point on surface lies on the west edge (edges are inside)', year: 1975, matches: 1 }, // 900111
    { name: 'a U-shaped footprint whose centroid is outside the view but its point on surface inside', year: 1901, matches: 1 }, // 900113
    { name: 'a U-shaped footprint whose centroid is inside the view but its point on surface outside', year: 1900, matches: 0 }, // 900112
  ];
  for (const placement of placements) {
    test(`places ${placement.name} by its point on surface`, async () => {
      const answer = await run(planOf({ op: '=', args: [YEAR, placement.year] }));
      assert.equal(answer.spatialPopulation, 9);
      assert.equal(answer.confirmedMatches, placement.matches);
    });
  }
});

describe('POST /v1/run: conditions and completeness', () => {
  test('answers a multi-valued and a single-valued condition together, in the FR-5.5 sentence form', async () => {
    const plan = planOf({
      op: 'and',
      args: [
        { op: 'a_contains', args: [LAND_USE, ['Residential']] },
        { op: '=', args: [MATERIAL, 'Brick'] },
      ],
    });
    const answer = await run(plan);
    assert.equal(answer.status, 'answer');
    assert.deepEqual(answer.plan, plan);
    assert.equal(answer.spatialPopulation, 9);
    // Both recorded: 900101, 900102, 900103, 900109, 900111, 900113. Residential and Brick: 900101.
    assert.equal(answer.recordedCount, 6);
    assert.equal(answer.confirmedMatches, 1);
    assert.deepEqual(answer.share, { numerator: 1, denominator: 6, value: 1 / 6, isUndefined: false, undefinedReason: null });
    assert.deepEqual(answer.fields, [
      { key: 'current_landuse_group', title: 'Land use', ambiguity: null },
      { key: 'construction_core_material', title: 'Main material', ambiguity: null },
    ]);
    assert.equal(
      sentenceAfterAsOf(answer),
      'of 9 mapped buildings in this view, Land use and Main material are both recorded for 6; 1 is recorded as ' +
        'matching Land use includes "Residential" and Main material is "Brick".',
    );
    assert.ok(Math.abs(Date.parse(answer.asOf) - Date.now()) < 60_000, 'asOf is the time of the run');
    assert.match(answer.asOf, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('applies several filter steps together', async () => {
    const answer = await run(planOf({ op: 'a_contains', args: [LAND_USE, ['Residential']] }, { op: '=', args: [MATERIAL, 'Stone'] }));
    // Residential and Stone: 900102, 900111.
    assert.deepEqual([answer.recordedCount, answer.confirmedMatches], [6, 2]);
  });

  test('counts an OR match whose other field is blank as confirmed, but not among recorded buildings', async () => {
    const answer = await run(
      planOf({
        op: 'or',
        args: [
          { op: 'a_contains', args: [LAND_USE, ['Residential']] },
          { op: '=', args: [MATERIAL, 'Stone'] },
        ],
      }),
    );
    // TRUE: 900101, 900102, 900111, and 900105 (Residential, material blank: TRUE or unknown is TRUE).
    assert.equal(answer.confirmedMatches, 4);
    // Both recorded: 6, of which 900101, 900102 and 900111 match.
    assert.equal(answer.recordedCount, 6);
    assert.deepEqual(answer.share, { numerator: 3, denominator: 6, value: 0.5, isUndefined: false, undefinedReason: null });
    assert.equal(
      sentenceAfterAsOf(answer),
      'of 9 mapped buildings in this view, Land use and Main material are both recorded for 6; 4 are recorded as ' +
        'matching Land use includes "Residential" or Main material is "Stone", 3 of them among those 6.',
    );
  });

  test('words zero matches with partial coverage as zero confirmed matches', async () => {
    const answer = await run(planOf({ op: '=', args: [MATERIAL, 'Wood'] }));
    // Material recorded for 7 of 9 (900105 and 900106 are blank); nobody is Wood.
    assert.deepEqual([answer.recordedCount, answer.confirmedMatches], [7, 0]);
    assert.deepEqual(answer.share, { numerator: 0, denominator: 7, value: 0, isUndefined: false, undefinedReason: null });
    assert.equal(
      sentenceAfterAsOf(answer),
      'of 9 mapped buildings in this view, Main material is recorded for 7; there are zero confirmed matches for ' +
        'Main material is "Wood".',
    );
  });

  test('gives a field with no data anywhere a recorded count of zero and an undefined share, never 0%', async () => {
    const answer = await run(planOf({ op: '=', args: [TYPOLOGY, 'Low-rise'] }));
    assert.deepEqual([answer.spatialPopulation, answer.recordedCount, answer.confirmedMatches], [9, 0, 0]);
    assert.deepEqual(answer.share, {
      numerator: 0,
      denominator: 0,
      value: null,
      isUndefined: true,
      undefinedReason: 'No building in this view has Typology recorded, so the share among recorded buildings is undefined, not 0%.',
    });
    assert.equal(
      sentenceAfterAsOf(answer),
      'of 9 mapped buildings in this view, Typology is recorded for none; there are zero confirmed matches for ' +
        'Typology is "Low-rise".',
    );
  });

  test('reads null, empty text and an empty list as blank', async () => {
    // Land use is null for 900104 and an empty list for 900106.
    const blankLandUse = await run(planOf({ op: 'blank', args: [LAND_USE] }));
    // "is blank" is never unknown, so every building in the view is a denominator.
    assert.deepEqual([blankLandUse.recordedCount, blankLandUse.confirmedMatches], [9, 2]);
    assert.deepEqual(blankLandUse.share, { numerator: 2, denominator: 9, value: 2 / 9, isUndefined: false, undefinedReason: null });
    assert.equal(sentenceAfterAsOf(blankLandUse), 'of 9 mapped buildings in this view, 2 meet the condition Land use is blank.');
    // Street is 'Fixture Lane' for 900101, empty text for 900103 and null for the rest.
    const recordedStreet = await run(planOf({ op: 'recorded', args: [STREET] }));
    assert.deepEqual([recordedStreet.recordedCount, recordedStreet.confirmedMatches], [9, 1]);
    // An empty street is unknown, so "is not Fixture Lane" does not match it.
    const notFixtureLane = await run(planOf({ op: '<>', args: [STREET, 'Fixture Lane'] }));
    assert.equal(notFixtureLane.confirmedMatches, 0);
    // Nor does NOT turn a blank material into a match: Stone 900102, 900111; Steel 900109.
    const notBrick = await run(planOf({ op: 'not', args: [{ op: '=', args: [MATERIAL, 'Brick'] }] }));
    assert.equal(notBrick.confirmedMatches, 3);
  });

  test('counts only the fields whose values a condition compares towards the recorded count', async () => {
    const answer = await run(
      planOf({ op: 'and', args: [{ op: 'a_contains', args: [LAND_USE, ['Residential']] }, { op: 'blank', args: [MATERIAL] }] }),
    );
    // Land use recorded: 7. Residential with material blank: 900105.
    assert.deepEqual([answer.recordedCount, answer.confirmedMatches, answer.share.numerator], [7, 1, 1]);
    assert.deepEqual(answer.fields.map((field) => field.key), ['current_landuse_group', 'construction_core_material']);
    assert.equal(
      sentenceAfterAsOf(answer),
      'of 9 mapped buildings in this view, Land use is recorded for 7; 1 is recorded as matching Land use includes ' +
        '"Residential" and Main material is blank.',
    );
  });

  test('compares a number field in its own column type', async () => {
    // Height is a real (4-byte float) column: 2.3 for 900101, 10.5 for 900102.
    assert.equal((await run(planOf({ op: '=', args: [HEIGHT, 2.3] }))).confirmedMatches, 1);
    assert.equal((await run(planOf({ op: 'between', args: [HEIGHT, 2.3, 10.5] }))).confirmedMatches, 2);
    assert.equal((await run(planOf({ op: 'in', args: [HEIGHT, [2.3, 7]] }))).confirmedMatches, 1);
    assert.equal((await run(planOf({ op: '<=', args: [HEIGHT, 2.3] }))).confirmedMatches, 1);
  });

  test('treats a value as a value, never as SQL', async () => {
    for (const value of ["Fixture Lane' OR '1'='1", 'Fixture Lane; DROP TABLE buildings; --', '$1', 'Fixture Lane\\']) {
      const answer = await run(planOf({ op: '=', args: [STREET, value] }));
      assert.deepEqual([answer.spatialPopulation, answer.recordedCount, answer.confirmedMatches], [9, 1, 0], value);
    }
    assert.equal((await run(planOf({ op: '=', args: [STREET, 'Fixture Lane'] }))).confirmedMatches, 1);
  });

  test('compares a multi-valued field with a list as sets', async () => {
    const count = async (op: 'a_contains' | 'a_overlaps' | 'a_equals' | 'a_containedBy', values: string[]) =>
      (await run(planOf({ op, args: [LAND_USE, values] }))).confirmedMatches;
    assert.equal(await count('a_contains', ['Residential', 'Retail']), 1); // 900102
    assert.equal(await count('a_overlaps', ['Retail', 'Industry']), 4); // 900102, 900103, 900109, 900113
    assert.equal(await count('a_equals', ['Retail']), 2); // 900103, 900113
    assert.equal(await count('a_containedBy', ['Residential', 'Retail']), 6); // all recorded but 900109
  });

  test('filters by ranges and sets of values', async () => {
    const between = await run(planOf({ op: 'between', args: [YEAR, 1950, 1985] }));
    assert.equal(between.confirmedMatches, 4); // 1950, 1985, 1960, 1975: both ends included
    assert.equal(between.recordedCount, 7);
    assert.match(between.sentence, /4 are recorded as matching Year built is from 1950 to 1985\.$/);
    const atLeast = await run(planOf({ op: '>=', args: [YEAR, 1990] }));
    assert.equal(atLeast.confirmedMatches, 2); // 2001, 1990
    const oneOf = await run(planOf({ op: 'in', args: [MATERIAL, ['Stone', 'Steel']] }));
    assert.equal(oneOf.confirmedMatches, 3); // 900102, 900109, 900111
    assert.match(oneOf.sentence, /3 are recorded as matching Main material is one of "Stone" or "Steel"\.$/);
  });

  test('passes on the catalogue note for a field whose stored value may be a default', async () => {
    const answer = await run(planOf({ op: '>=', args: [STOREYS, 4] }));
    // 900104 and 900106 hold the default 0, which reads as recorded until missing-value metadata says otherwise.
    assert.deepEqual([answer.recordedCount, answer.confirmedMatches], [9, 2]);
    assert.deepEqual(answer.fields, [
      {
        key: 'size_storeys_core',
        title: 'Number of storeys',
        ambiguity: 'The database stores 0 when nothing is entered, so a recorded 0 may not be an observation.',
      },
    ]);
  });

  test('answers a view with no buildings', async () => {
    const answer = await run({ ...planOf({ op: '=', args: [MATERIAL, 'Brick'] }), area: { type: 'viewport', bbox: [10, 10, 10.001, 10.001] } });
    assert.deepEqual([answer.spatialPopulation, answer.recordedCount, answer.confirmedMatches], [0, 0, 0]);
    assert.equal(answer.share.isUndefined, true);
    assert.equal(
      sentenceAfterAsOf(answer),
      'there are no mapped buildings in this view, so there are zero confirmed matches for Main material is "Brick".',
    );
  });
});

describe('POST /v1/validate and invalid runs', () => {
  async function problems(plan: unknown): Promise<PlanProblem[]> {
    const response = await call('POST', '/v1/validate', { plan });
    assert.equal(response.status, 200);
    assertFollowsSchema(response.body, 'ValidateResponse');
    const body = response.body as InvalidResponse;
    assert.equal(body.status, 'invalid');
    return body.errors;
  }

  test('says a valid plan is valid, without running it', async () => {
    const response = await call('POST', '/v1/validate', { plan: planOf({ op: '=', args: [MATERIAL, 'Brick'] }) });
    assert.deepEqual(response, { status: 200, body: { status: 'valid' } });
  });

  test('rejects a malformed plan with messages a person can act on', async () => {
    assert.deepEqual(await problems('count the buildings'), [
      { message: 'The plan must be a JSON object with "version", "area", "steps" and "outputs".', step: null, field: null, path: '' },
    ]);
    assert.deepEqual(
      await problems({ version: '1.0.0', steps: [{ type: 'buffer' }], outputs: [], colour: 'red' }),
      [
        { message: 'The plan has a member "colour" that plan format 1.0.0 does not have.', step: null, field: null, path: '/colour' },
        {
          message: 'The plan has no "area". Give the current view as {"type": "viewport", "bbox": [west, south, east, north]}.',
          step: null,
          field: null,
          path: '/area',
        },
        {
          message: 'Step 1 is a "buffer" step, which plan format 1.0.0 does not offer; it offers "filter" steps.',
          step: 1,
          field: null,
          path: '/steps/0/type',
        },
        {
          message: 'The plan must ask for at least one output in "outputs", such as {"type": "number"}.',
          step: null,
          field: null,
          path: '/outputs',
        },
      ],
    );
    assert.deepEqual(await problems({ ...planOf(), version: '2.0.0', area: { type: 'viewport', bbox: [1, 0, 0, 1] } }), [
      { message: 'The plan is in format "2.0.0", but this engine runs plan format 1.0.0.', step: null, field: null, path: '/version' },
      {
        message: "The view's west edge must be less than its east edge. A view across the 180° meridian is not supported.",
        step: null,
        field: null,
        path: '/area/bbox',
      },
    ]);
  });

  test('rejects an unknown field, naming the step', async () => {
    assert.deepEqual(await problems(planOf({ op: '=', args: [property('roof_colour'), 'Red'] })), [
      { message: 'Step 1: there is no field "roof_colour" in the catalogue.', step: 1, field: null, path: '/steps/0/filter/args/0/property' },
    ]);
  });

  test("rejects a value outside a field's allowed list, naming the field's title", async () => {
    assert.deepEqual(await problems(planOf({ op: 'recorded', args: [YEAR] }, { op: '=', args: [MATERIAL, 'Granite'] })), [
      {
        message:
          'Step 2: "Granite" is not one of the values "Main material" can take: "Wood", "Stone", "Brick", "Steel" and ' +
          '"Reinforced Concrete".',
        step: 2,
        field: 'construction_core_material',
        path: '/steps/1/filter/args/1',
      },
    ]);
    assert.deepEqual(await problems(planOf({ op: 'a_overlaps', args: [LAND_USE, ['Retail', 'Farm']] })), [
      {
        message: 'Step 1: "Farm" is not one of the values "Land use" can take: "Residential", "Retail", "Industry" and "Agriculture".',
        step: 1,
        field: 'current_landuse_group',
        path: '/steps/0/filter/args/1/1',
      },
    ]);
  });

  test("rejects an operator or a value that does not fit the field's type", async () => {
    const cases: Array<{ condition: Condition; message: string; field: string; path: string }> = [
      {
        condition: { op: '<', args: [MATERIAL, 'Brick'] },
        message: 'Step 1: "Main material" holds text, so it cannot be compared with "<"; use "=", "<>" or "in".',
        field: 'construction_core_material',
        path: '/steps/0/filter/op',
      },
      {
        condition: { op: '=', args: [LAND_USE, 'Retail'] },
        message:
          'Step 1: "Land use" can hold several values, so it needs a list condition (a_contains, a_overlaps, a_equals ' +
          'or a_containedBy), not "=".',
        field: 'current_landuse_group',
        path: '/steps/0/filter/op',
      },
      {
        condition: { op: 'a_contains', args: [MATERIAL, ['Brick']] },
        message: 'Step 1: "Main material" holds one value per building, so "a_contains" does not apply; use "=" or "in".',
        field: 'construction_core_material',
        path: '/steps/0/filter/op',
      },
      {
        condition: { op: '>', args: [YEAR, 'nineteen fifty'] },
        message: 'Step 1: "Year built" holds whole numbers, so "nineteen fifty" is not a value it can take; write a whole number such as 4.',
        field: 'date_year',
        path: '/steps/0/filter/args/1',
      },
      {
        condition: { op: 'between', args: [YEAR, 1990, 1950] },
        message: 'Step 1: the range for "Year built" runs from 1990 down to 1950; put the lower value first.',
        field: 'date_year',
        path: '/steps/0/filter/args',
      },
    ];
    for (const { condition, message, field, path } of cases) {
      assert.deepEqual(await problems(planOf(condition)), [{ message, step: 1, field, path }]);
    }
  });

  test('rejects conditions nested too deep, without failing', async () => {
    let deep: Condition = { op: '=', args: [MATERIAL, 'Brick'] };
    for (let level = 0; level < 25; level += 1) deep = { op: 'not', args: [deep] };
    assert.deepEqual(await problems(planOf(deep)), [
      {
        message: 'Step 1: conditions are nested more than 20 levels deep. Write the condition with fewer levels.',
        step: 1,
        field: null,
        path: `/steps/0/filter${'/args/0'.repeat(20)}`,
      },
    ]);
    // A body near the size limit made of nothing but nesting is refused, not an internal error.
    const body = `{"plan": {"version": "1.0.0", "area": {"type": "viewport", "bbox": [0, 0.0009, 0.0009, 0.0018]}, "steps": [{"type": "filter", "filter": ${'{"op": "not", "args": ['.repeat(40_000)}{"op": "blank", "args": [{"property": "date_year"}]}${']}'.repeat(40_000)}}], "outputs": [{"type": "number"}]}}`;
    const response = await fetch(`${service.baseUrl}/v1/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.ok(response.status >= 400 && response.status < 500, `status ${response.status}`);
  });

  test('refuses a number too large for the column it is compared with, as an invalid plan', async () => {
    // Height is a real column, whose largest value is about 3.4e38.
    const response = await call('POST', '/v1/run', { plan: planOf({ op: '>', args: [HEIGHT, 1e39] }) });
    assert.equal(response.status, 422);
    assertFollowsSchema(response.body, 'RunResponse');
    assert.deepEqual(response.body, {
      status: 'invalid',
      errors: [
        {
          message: 'A number in the plan is too large or too small for the field it is compared with.',
          step: null,
          field: null,
          path: '',
        },
      ],
    });
  });

  test('refuses to run an invalid plan, with the same messages', async () => {
    const plan = planOf({ op: '=', args: [MATERIAL, 'Granite'] });
    const response = await call('POST', '/v1/run', { plan });
    assert.equal(response.status, 422);
    assertFollowsSchema(response.body, 'RunResponse');
    assert.deepEqual(response.body, { status: 'invalid', errors: await problems(plan) });
  });

  test('answers 400 when the request is not an object holding a plan', async () => {
    for (const body of [[], { question: 'how many?' }, { plan: planOf(), extra: true }]) {
      const response = await call('POST', '/v1/run', body);
      assert.equal(response.status, 400);
      assertFollowsSchema(response.body, 'ErrorResponse');
    }
  });

  test('does not log the plan or its values', () => {
    assert.doesNotMatch(service.stdout(), /Granite|roof_colour|Residential/);
    assert.match(service.stdout(), /"route":"\/v1\/run"/);
  });
});
