// Running a validated plan: compile, execute in one read-only transaction, and assemble the
// answer contract (schemas/api-1.schema.json, Answer). "As of" is the transaction time of the
// statement that counted.

import type { Answer, Field, Plan, Share } from '../schemas/query-engine.d.ts';
import type { FieldCatalogue } from './catalogue.ts';
import { compileCount } from './compiler.ts';
import type { Executor } from './executor.ts';
import { answerSentence, joinWith, titleInSentence } from './sentence.ts';

interface CountRow {
  as_of: Date;
  spatial_population: string;
  recorded_count: string;
  confirmed_matches: string;
  confirmed_matches_among_recorded: string;
  [column: string]: unknown;
}

export async function runPlan(plan: Plan, catalogue: FieldCatalogue, executor: Executor): Promise<Answer> {
  const compiled = compileCount(plan, catalogue);
  const [row] = await executor.read((query) => query<CountRow>(compiled.sql, compiled.params));
  if (row === undefined) throw new Error('The count returned no row');

  const counts = {
    asOf: row.as_of,
    spatialPopulation: Number(row.spatial_population),
    recordedCount: Number(row.recorded_count),
    confirmedMatches: Number(row.confirmed_matches),
    confirmedMatchesAmongRecorded: Number(row.confirmed_matches_among_recorded),
  };
  return {
    status: 'answer',
    asOf: counts.asOf.toISOString(),
    plan,
    spatialPopulation: counts.spatialPopulation,
    recordedCount: counts.recordedCount,
    confirmedMatches: counts.confirmedMatches,
    share: share(counts, compiled.comparedFields),
    fields: compiled.fields.map((field) => ({ key: field.key, title: field.title, ambiguity: field.ambiguity })),
    sentence: answerSentence(plan, compiled.fields, compiled.comparedFields, counts),
  };
}

function share(
  counts: { spatialPopulation: number; recordedCount: number; confirmedMatchesAmongRecorded: number },
  comparedFields: readonly Field[],
): Share {
  const numerator = counts.confirmedMatchesAmongRecorded;
  const denominator = counts.recordedCount;
  if (denominator > 0) {
    return { numerator, denominator, value: numerator / denominator, isUndefined: false, undefinedReason: null };
  }
  // With no compared fields the recorded count is the spatial population, so only an empty view lands here.
  const titles = comparedFields.map(titleInSentence);
  const reason =
    counts.spatialPopulation === 0
      ? 'There are no mapped buildings in this view'
      : titles.length === 1
        ? `No building in this view has ${titles[0]} recorded`
        : `No building in this view has ${joinWith(titles, 'and')} ${titles.length === 2 ? 'both' : 'all'} recorded`;
  return {
    numerator,
    denominator,
    value: null,
    isUndefined: true,
    undefinedReason: `${reason}, so the share among recorded buildings is undefined, not 0%.`,
  };
}
