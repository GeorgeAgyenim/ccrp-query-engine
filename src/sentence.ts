// The answer's sentence, in the FR-5.5 form, from fixed templates (never from a language model):
//   As of 26 Nov 2026 16:01 UTC — of 9 mapped buildings in this view, Land use and Main material
//   are both recorded for 6; 1 is recorded as matching Land use includes "Residential" and Main
//   material is "Brick".
// Zero matches are "zero confirmed matches", so they are not read as "none exist".
// See docs/decisions/0011-http-api-v1-routes-and-answer.md.

import type { Condition, Field, Plan, Value } from '../schemas/query-engine.d.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "26 Nov 2026 14:05 UTC". Written out by hand so it does not depend on the runtime's locale data. */
export function formatAsOf(asOf: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return (
    `${asOf.getUTCDate()} ${MONTHS[asOf.getUTCMonth()]} ${asOf.getUTCFullYear()} ` +
    `${two(asOf.getUTCHours())}:${two(asOf.getUTCMinutes())} UTC`
  );
}

/** 12345 → "12,345". */
export function formatCount(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A field's title as it reads inside a sentence: without a trailing question mark or colon. */
export function titleInSentence(field: Field): string {
  return field.title.trim().replace(/\s*[?:.]+$/, '');
}

export function joinWith(items: readonly string[], conjunction: string): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items.at(-1)}`;
}

export interface SentenceCounts {
  asOf: Date;
  spatialPopulation: number;
  recordedCount: number;
  confirmedMatches: number;
  /** Confirmed matches among the recorded buildings: the share's numerator. */
  confirmedMatchesAmongRecorded: number;
}

/**
 * `fields`: every queried field, to name them in the condition; `comparedFields`: those whose
 * values are compared, the recorded count's fields.
 */
export function answerSentence(
  plan: Plan,
  fields: readonly Field[],
  comparedFields: readonly Field[],
  counts: SentenceCounts,
): string {
  const lead = `As of ${formatAsOf(counts.asOf)} — `;
  const population = counts.spatialPopulation;
  const buildings = (count: number) => `${formatCount(count)} mapped building${count === 1 ? '' : 's'}`;

  if (plan.steps.length === 0) {
    if (population === 0) return `${lead}there are no mapped buildings in this view.`;
    return `${lead}there ${population === 1 ? 'is' : 'are'} ${buildings(population)} in this view.`;
  }

  const byKey = new Map(fields.map((field) => [field.key, field]));
  // Steps join with "and"; a lone "or" step needs no brackets.
  const outer = plan.steps.length === 1 && plan.steps[0]?.filter.op === 'or' ? 'or' : 'and';
  const condition = plan.steps.map((step) => describe(step.filter, byKey, outer)).join(' and ');
  if (population === 0) {
    return `${lead}there are no mapped buildings in this view, so there are zero confirmed matches for ${condition}.`;
  }
  const matches = counts.confirmedMatches;

  // Only "recorded" and "blank" conditions: nothing is unknown, so every building is counted.
  if (comparedFields.length === 0) {
    const meet = matches === 0 ? 'none meets' : `${formatCount(matches)} ${matches === 1 ? 'meets' : 'meet'}`;
    return `${lead}of ${buildings(population)} in this view, ${meet} the condition ${condition}.`;
  }

  const titles = comparedFields.map(titleInSentence);
  const recordedFor = counts.recordedCount === 0 ? 'none' : formatCount(counts.recordedCount);
  const recorded =
    titles.length === 1
      ? `${titles[0]} is recorded for ${recordedFor}`
      : `${joinWith(titles, 'and')} are ${titles.length === 2 ? 'both' : 'all'} recorded for ${recordedFor}`;
  if (matches === 0) {
    return `${lead}of ${buildings(population)} in this view, ${recorded}; there are zero confirmed matches for ${condition}.`;
  }
  // With "or", a building can match while another compared field is blank: say how many of the
  // matches are among the recorded buildings, so the two numbers are not read as "M of R".
  const among = counts.confirmedMatchesAmongRecorded;
  const ofThem =
    among === matches ? '' : `, ${among === 0 ? 'none' : formatCount(among)} of them among those ${recordedFor}`;
  return (
    `${lead}of ${buildings(population)} in this view, ${recorded}; ${formatCount(matches)} ` +
    `${matches === 1 ? 'is' : 'are'} recorded as matching ${condition}${ofThem}.`
  );
}

function value(item: Value): string {
  if (typeof item === 'string') return JSON.stringify(item);
  if (typeof item === 'boolean') return item ? 'yes' : 'no';
  return String(item);
}

/** A condition in words. `parent` is the enclosing and/or, to bracket a mixed one. */
function describe(node: Condition, fields: ReadonlyMap<string, Field>, parent: 'and' | 'or'): string {
  switch (node.op) {
    case 'and':
    case 'or': {
      const op = node.op;
      const text = node.args.map((arg) => describe(arg, fields, op)).join(` ${op} `);
      return op === parent ? text : `(${text})`;
    }
    case 'not':
      return `not (${describe(node.args[0], fields, 'and')})`;
    default: {
      const field = fields.get(node.args[0].property);
      if (field === undefined) throw new Error('The sentence names a field the plan did not query');
      return describeField(node, titleInSentence(field));
    }
  }
}

function describeField(node: Exclude<Condition, { op: 'and' | 'or' | 'not' }>, title: string): string {
  switch (node.op) {
    case 'recorded':
      return `${title} is recorded`;
    case 'blank':
      return `${title} is blank`;
    case 'between':
      return `${title} is from ${node.args[1]} to ${node.args[2]}`;
    case 'in': {
      const values = node.args[1].map((item) => value(item));
      return values.length === 1 ? `${title} is ${values[0]}` : `${title} is one of ${joinWith(values, 'or')}`;
    }
    case 'a_contains':
    case 'a_overlaps':
    case 'a_equals':
    case 'a_containedBy': {
      const values = node.args[1].map((item) => value(item));
      if (node.op === 'a_equals') return `${title} is exactly ${joinWith(values, 'and')}`;
      if (node.op === 'a_containedBy') return `${title} has no values other than ${joinWith(values, 'and')}`;
      if (values.length === 1) return `${title} includes ${values[0]}`;
      return node.op === 'a_contains'
        ? `${title} includes all of ${joinWith(values, 'and')}`
        : `${title} includes any of ${joinWith(values, 'or')}`;
    }
    default: {
      const words = { '=': 'is', '<>': 'is not', '<': 'is less than', '<=': 'is at most', '>': 'is more than', '>=': 'is at least' }[
        node.op
      ];
      return `${title} ${words} ${value(node.args[1])}`;
    }
  }
}
