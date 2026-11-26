// The validator: checks a plan before anything runs (FR-1.5). The plan JSON Schema
// (schemas/plan-1.schema.json) decides the shape; this module walks the plan to write each
// problem as a sentence a non-technical person can act on, naming the step and the field's
// title, and checks what the schema cannot: that fields exist in the catalogue, that values
// are allowed and of the field's type, and that each operator fits its field.
// If the schema rejects a plan this walk found nothing wrong with, the schema's own finding
// is reported, so no plan the published schema rejects can run.
// See docs/decisions/0010-plan-format-1-json-shape.md.

import type { Field, Plan, PlanProblem } from '../schemas/query-engine.d.ts';
import { valueFitsType, type FieldCatalogue } from './catalogue.ts';
import { PLAN_VERSION, PLAN_VERSIONS, describeSchemaError, validatePlanShape } from './schemas.ts';
import { joinWith } from './sentence.ts';

export type Validation = { valid: true; plan: Plan } | { valid: false; errors: PlanProblem[] };

const FORMAT = `plan format ${PLAN_VERSION}`;
const MAX_LATITUDE = 85.0511287798;
const COMPARISONS = ['=', '<>', '<', '<=', '>', '>='];
const ORDERINGS = ['<', '<=', '>', '>='];
const ARRAY_OPS = ['a_equals', 'a_contains', 'a_containedBy', 'a_overlaps'];
const RECORDED_OPS = ['recorded', 'blank'];
const LOGICAL_OPS = ['and', 'or', 'not'];
const ALL_OPS = [...COMPARISONS, 'between', 'in', ...ARRAY_OPS, ...RECORDED_OPS, ...LOGICAL_OPS];
/** How many allowed values a message lists before saying how many more there are. */
const LISTED_VALUES = 10;
/**
 * How deep and/or/not may nest. Far more than a person or the builder writes, and it keeps a
 * deliberately deep plan from exhausting the validator's stack or PostgreSQL's.
 */
export const MAX_NESTING = 20;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A sent value as a message shows it: text quoted and shortened, other values by kind. */
function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.length > 60 ? `${value.slice(0, 57)}...` : value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  return Array.isArray(value) ? 'a list' : 'an object';
}

class Problems {
  readonly list: PlanProblem[] = [];
  add(path: string, message: string, step: number | null = null, field: string | null = null): void {
    this.list.push({ message, step, field, path });
  }
  unknownMembers(value: Json, allowed: readonly string[], path: string, what: string, step: number | null = null): void {
    for (const member of Object.keys(value)) {
      if (!allowed.includes(member)) {
        this.add(`${path}/${escapePointer(member)}`, `${what} has a member ${show(member)} that ${FORMAT} does not have.`, step);
      }
    }
  }
}

function escapePointer(member: string): string {
  return member.replaceAll('~', '~0').replaceAll('/', '~1');
}

export function validatePlan(plan: unknown, catalogue: FieldCatalogue): Validation {
  const problems = new Problems();
  if (!isObject(plan)) {
    problems.add('', `The plan must be a JSON object with "version", "area", "steps" and "outputs".`);
    return { valid: false, errors: problems.list };
  }
  problems.unknownMembers(plan, ['version', 'area', 'steps', 'outputs'], '', 'The plan');

  if (plan['version'] === undefined) {
    problems.add('/version', `The plan has no "version". A plan in ${FORMAT} has "version": "${PLAN_VERSION}".`);
  } else if (typeof plan['version'] !== 'string' || !PLAN_VERSIONS.includes(plan['version'])) {
    problems.add(
      '/version',
      `The plan is in format ${show(plan['version'])}, but this engine runs plan format ${joinWith(PLAN_VERSIONS, 'and')}.`,
    );
  }

  checkArea(plan['area'], problems);

  const steps = plan['steps'];
  if (!Array.isArray(steps)) {
    problems.add('/steps', `The plan's "steps" must be a list of steps (it may be empty).`);
  } else {
    steps.forEach((step, index) => checkStep(step, index + 1, catalogue, problems));
  }

  const outputs = plan['outputs'];
  if (!Array.isArray(outputs) || outputs.length === 0) {
    problems.add('/outputs', `The plan must ask for at least one output in "outputs", such as {"type": "number"}.`);
  } else {
    outputs.forEach((output, index) => {
      const path = `/outputs/${index}`;
      if (!isObject(output) || output['type'] !== 'number') {
        const type = isObject(output) ? output['type'] : output;
        problems.add(path, `Output ${index + 1} (${show(type)}) is not available; ${FORMAT} offers the "number" output.`);
      } else {
        problems.unknownMembers(output, ['type'], path, `Output ${index + 1}`);
      }
    });
  }

  if (problems.list.length === 0 && !validatePlanShape(plan)) {
    // The walk above should find everything the schema does; if not, say what the schema says.
    for (const error of (validatePlanShape.errors ?? []).slice(0, 5)) {
      problems.add(error.instancePath, `The plan does not follow ${FORMAT}: ${describeSchemaError(error)}.`);
    }
  }
  return problems.list.length === 0 ? { valid: true, plan: plan as unknown as Plan } : { valid: false, errors: problems.list };
}

function checkArea(area: unknown, problems: Problems): void {
  const example = '{"type": "viewport", "bbox": [west, south, east, north]}';
  if (area === undefined) {
    problems.add('/area', `The plan has no "area". Give the current view as ${example}.`);
    return;
  }
  if (!isObject(area)) {
    problems.add('/area', `The plan's "area" must be an object such as ${example}.`);
    return;
  }
  if (area['type'] !== 'viewport') {
    problems.add(
      '/area/type',
      area['type'] === undefined
        ? `The area needs a "type"; ${FORMAT} offers the current view, "viewport".`
        : `The area type ${show(area['type'])} is not available; ${FORMAT} offers the current view, "viewport".`,
    );
    return;
  }
  problems.unknownMembers(area, ['type', 'bbox'], '/area', 'The area');
  const bbox = area['bbox'];
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((edge) => typeof edge === 'number' && Number.isFinite(edge))) {
    problems.add('/area/bbox', `The view's "bbox" must be four numbers: west, south, east and north, in degrees.`);
    return;
  }
  const [west, south, east, north] = bbox as [number, number, number, number];
  if ([west, east].some((longitude) => longitude < -180 || longitude > 180)) {
    problems.add('/area/bbox', `The view's west and east edges must be longitudes from -180 to 180.`);
  } else if (west >= east) {
    problems.add(
      '/area/bbox',
      `The view's west edge must be less than its east edge. A view across the 180° meridian is not supported.`,
    );
  }
  if ([south, north].some((latitude) => latitude < -MAX_LATITUDE || latitude > MAX_LATITUDE)) {
    problems.add(
      '/area/bbox',
      `The view's south and north edges must be latitudes from -${MAX_LATITUDE} to ${MAX_LATITUDE}, the web map's limits.`,
    );
  } else if (south >= north) {
    problems.add('/area/bbox', `The view's south edge must be less than its north edge.`);
  }
}

function checkStep(step: unknown, number: number, catalogue: FieldCatalogue, problems: Problems): void {
  const path = `/steps/${number - 1}`;
  if (!isObject(step)) {
    problems.add(path, `Step ${number} must be an object such as {"type": "filter", "filter": ...}.`, number);
    return;
  }
  if (step['type'] !== 'filter') {
    problems.add(
      `${path}/type`,
      step['type'] === undefined
        ? `Step ${number} needs a "type"; ${FORMAT} offers "filter" steps.`
        : `Step ${number} is a ${show(step['type'])} step, which ${FORMAT} does not offer; it offers "filter" steps.`,
      number,
    );
    return;
  }
  problems.unknownMembers(step, ['type', 'filter'], path, `Step ${number}`, number);
  if (step['filter'] === undefined) {
    problems.add(`${path}/filter`, `Step ${number} has no "filter" condition.`, number);
    return;
  }
  new ConditionChecker(number, catalogue, problems).check(step['filter'], `${path}/filter`);
}

class ConditionChecker {
  private readonly step: number;
  private readonly catalogue: FieldCatalogue;
  private readonly problems: Problems;

  constructor(step: number, catalogue: FieldCatalogue, problems: Problems) {
    this.step = step;
    this.catalogue = catalogue;
    this.problems = problems;
  }

  private add(path: string, message: string, field: Field | null = null): void {
    this.problems.add(path, `Step ${this.step}: ${message}`, this.step, field?.key ?? null);
  }

  check(condition: unknown, path: string, depth = 1): void {
    if (depth > MAX_NESTING) {
      this.add(path, `conditions are nested more than ${MAX_NESTING} levels deep. Write the condition with fewer levels.`);
      return;
    }
    if (!isObject(condition) || typeof condition['op'] !== 'string') {
      this.add(path, 'a condition must be an object with "op" and "args", such as {"op": "=", "args": [{"property": "<field>"}, "<value>"]}.');
      return;
    }
    const op = condition['op'];
    for (const member of Object.keys(condition)) {
      if (member !== 'op' && member !== 'args') {
        this.add(`${path}/${escapePointer(member)}`, `the ${show(op)} condition has a member ${show(member)} that ${FORMAT} does not have.`);
      }
    }
    if (!ALL_OPS.includes(op)) {
      this.add(`${path}/op`, `${show(op)} is not an operator the engine offers. Use one of ${ALL_OPS.join(', ')}.`);
      return;
    }
    const args = condition['args'];
    if (!Array.isArray(args)) {
      this.add(`${path}/args`, `the ${show(op)} condition needs "args", a list.`);
      return;
    }
    const argsPath = `${path}/args`;

    if (op === 'and' || op === 'or') {
      if (args.length < 2) this.add(argsPath, `${show(op)} needs at least two conditions in its "args".`);
      args.forEach((arg, index) => this.check(arg, `${argsPath}/${index}`, depth + 1));
      return;
    }
    if (op === 'not') {
      if (args.length !== 1) this.add(argsPath, `"not" needs exactly one condition in its "args".`);
      else this.check(args[0], `${argsPath}/0`, depth + 1);
      return;
    }

    const field = this.fieldOf(args[0], op, `${argsPath}/0`);
    const arity = RECORDED_OPS.includes(op) ? 1 : op === 'between' ? 3 : 2;
    if (args.length !== arity) {
      const shape = {
        1: 'a field alone: [{"property": "<field>"}]',
        2: ARRAY_OPS.includes(op) || op === 'in'
          ? 'a field and a list of values: [{"property": "<field>"}, ["<value>", ...]]'
          : 'a field and one value: [{"property": "<field>"}, <value>]',
        3: 'a field and two numbers, lowest first: [{"property": "<field>"}, <low>, <high>]',
      }[arity];
      this.add(argsPath, `${show(op)} needs ${shape}.`, field);
      return;
    }
    if (field === undefined) return;
    if (!this.operatorFits(op, field, `${path}/op`)) return;

    if (COMPARISONS.includes(op)) {
      this.checkValue(args[1], field, `${argsPath}/1`);
    } else if (op === 'between') {
      const lowOk = this.checkValue(args[1], field, `${argsPath}/1`);
      const highOk = this.checkValue(args[2], field, `${argsPath}/2`);
      if (lowOk && highOk && (args[1] as number) > (args[2] as number)) {
        this.add(
          argsPath,
          `the range for "${field.title}" runs from ${show(args[1])} down to ${show(args[2])}; put the lower value first.`,
          field,
        );
      }
    } else if (op === 'in' || ARRAY_OPS.includes(op)) {
      const list = args[1];
      if (!Array.isArray(list) || list.length === 0) {
        this.add(`${argsPath}/1`, `${show(op)} needs a list of at least one value after the field.`, field);
        return;
      }
      list.forEach((value, index) => this.checkValue(value, field, `${argsPath}/1/${index}`));
    }
  }

  private fieldOf(ref: unknown, op: string, path: string): Field | undefined {
    if (!isObject(ref) || typeof ref['property'] !== 'string' || Object.keys(ref).length !== 1) {
      this.add(path, `the ${show(op)} condition must name a field first, as {"property": "<field key>"}.`);
      return undefined;
    }
    const field = this.catalogue.field(ref['property']);
    if (field === undefined) {
      this.add(`${path}/property`, `there is no field ${show(ref['property'])} in the catalogue.`);
    }
    return field;
  }

  private operatorFits(op: string, field: Field, path: string): boolean {
    const title = `"${field.title}"`;
    if (RECORDED_OPS.includes(op)) return true;
    if (field.multiValued && !ARRAY_OPS.includes(op)) {
      this.add(
        path,
        `${title} can hold several values, so it needs a list condition (a_contains, a_overlaps, a_equals or ` +
          `a_containedBy), not ${show(op)}.`,
        field,
      );
      return false;
    }
    if (!field.multiValued && ARRAY_OPS.includes(op)) {
      this.add(path, `${title} holds one value per building, so ${show(op)} does not apply; use "=" or "in".`, field);
      return false;
    }
    const ordered = ORDERINGS.includes(op) || op === 'between';
    if (field.type === 'text' && ordered) {
      this.add(path, `${title} holds text, so it cannot be compared with ${show(op)}; use "=", "<>" or "in".`, field);
      return false;
    }
    if (field.type === 'boolean' && (ordered || op === 'in')) {
      this.add(path, `${title} holds yes/no values, so it cannot be compared with ${show(op)}; use "=" or "<>".`, field);
      return false;
    }
    return true;
  }

  /** Whether `value` is of the field's type and allowed for it; reports why not. */
  private checkValue(value: unknown, field: Field, path: string): boolean {
    const title = `"${field.title}"`;
    const kinds = { text: 'text', integer: 'whole numbers', number: 'numbers', boolean: 'yes/no values' } as const;
    if (!valueFitsType(value, field.type)) {
      const hint = { text: 'write it as text in quotes', integer: 'write a whole number such as 4', number: 'write a number such as 4.5', boolean: 'use true or false' }[field.type];
      this.add(path, `${title} holds ${kinds[field.type]}, so ${show(value)} is not a value it can take; ${hint}.`, field);
      return false;
    }
    const allowed = field.allowedValues;
    if (allowed !== null && !allowed.includes(value as string | number)) {
      const listed = allowed.slice(0, LISTED_VALUES).map(show);
      const more = allowed.length > LISTED_VALUES ? ` and ${allowed.length - LISTED_VALUES} more (see the catalogue)` : '';
      this.add(
        path,
        `${show(value)} is not one of the values ${title} can take: ${more === '' ? joinWith(listed, 'and') : `${listed.join(', ')}${more}`}.`,
        field,
      );
      return false;
    }
    return true;
  }
}
