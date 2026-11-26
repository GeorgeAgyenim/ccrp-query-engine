// The compiler: the only path from a plan to SQL (FR-1.4). It takes a plan the validator has
// accepted and writes one parameterised PostGIS statement:
//  - every value travels as a $n parameter; nothing the plan holds is written into the SQL
//    text, and operators are looked up in fixed tables;
//  - column names come only from the field catalogue, quoted as identifiers;
//  - only the PostGIS functions in ALLOWED_POSTGIS_FUNCTIONS appear, checked before returning.
//
// A building is in the view when its point on surface (ST_PointOnSurface) is inside it or on its
// edge (ST_Covers), ADR-0005. Each queried field is read once, normalised so that blank values
// (null, empty text, an empty list) are SQL null; the filter then follows SQL's three-valued
// logic, which is CQL2's. Counts are computed on the full set.
//
// The recorded count covers the fields whose values a condition compares. A field tested only by
// `recorded` or `blank` is left out of it: those conditions are TRUE or FALSE for every building,
// never unknown, so they need nothing recorded.

import pg from 'pg';
import type { Condition, Field, Plan, Value } from '../schemas/query-engine.d.ts';
import type { FieldCatalogue } from './catalogue.ts';
import { EngineError } from './safe-log.ts';

export const ALLOWED_POSTGIS_FUNCTIONS = ['ST_Covers', 'ST_MakeEnvelope', 'ST_PointOnSurface', 'ST_Transform'];

/** colouring-core stores footprints in Web Mercator; plans give the view in WGS 84. */
const FOOTPRINT_SRID = 3857;
const PLAN_SRID = 4326;

export interface CompiledCount {
  sql: string;
  params: unknown[];
  /** Every queried field, in order of first use. */
  fields: Field[];
  /** The fields whose values a condition compares: the recorded count's fields. */
  comparedFields: Field[];
}

/**
 * The SQL type a field's values are compared as, or null for numbers: those are compared in the
 * column's own type (real, double precision, numeric), so a stored 2.3 in a real column equals the
 * plan's 2.3. Whole numbers are compared as bigint, which every integer column fits.
 */
const SQL_TYPES: Readonly<Record<Field['type'], string | null>> = {
  text: 'text',
  integer: 'bigint',
  number: null,
  boolean: 'boolean',
};

const COMPARISONS: Readonly<Record<string, string>> = { '=': '=', '<>': '<>', '<': '<', '<=': '<=', '>': '>', '>=': '>=' };
const ARRAY_OPERATORS: Readonly<Record<string, string>> = { a_contains: '@>', a_containedBy: '<@', a_overlaps: '&&' };

export class CompileError extends EngineError {
  override name = 'CompileError';
}

export function compileCount(plan: Plan, catalogue: FieldCatalogue): CompiledCount {
  const params: unknown[] = [];
  /** A parameter, typed when `type` is given; untyped, PostgreSQL takes the type of what it is compared with. */
  const param = (value: unknown, type: string | null): string => {
    params.push(value);
    return type === null ? `$${params.length}` : `$${params.length}::${type}`;
  };

  const [west, south, east, north] = plan.area.bbox;
  const envelope =
    `ST_MakeEnvelope(${param(west, 'double precision')}, ${param(south, 'double precision')}, ` +
    `${param(east, 'double precision')}, ${param(north, 'double precision')}, ${PLAN_SRID})`;

  const aliases = new Map<string, string>();
  const fields: Field[] = [];
  const compared = new Set<string>();
  const alias = (key: string, comparesValue: boolean): { name: string; field: Field } => {
    const field = catalogue.field(key);
    if (field === undefined) throw new CompileError('The plan names a field the catalogue does not have');
    let name = aliases.get(key);
    if (name === undefined) {
      name = `f${aliases.size + 1}`;
      aliases.set(key, name);
      fields.push(field);
    }
    if (comparesValue) compared.add(key);
    return { name, field };
  };
  const listType = (field: Field) => {
    const type = SQL_TYPES[field.type];
    return type === null ? null : `${type}[]`;
  };

  const condition = (node: Condition): string => {
    switch (node.op) {
      case 'and':
      case 'or':
        return `(${node.args.map(condition).join(node.op === 'and' ? ' AND ' : ' OR ')})`;
      case 'not':
        return `(NOT ${condition(node.args[0])})`;
      case 'recorded':
      case 'blank': {
        const { name } = alias(node.args[0].property, false);
        return `(${name} IS ${node.op === 'recorded' ? 'NOT ' : ''}NULL)`;
      }
      case 'between': {
        const { name, field } = alias(node.args[0].property, true);
        const type = SQL_TYPES[field.type];
        return `(${name} BETWEEN ${param(node.args[1], type)} AND ${param(node.args[2], type)})`;
      }
      case 'in': {
        const { name, field } = alias(node.args[0].property, true);
        return `(${name} = ANY(${param(node.args[1], listType(field))}))`;
      }
      case 'a_equals':
      case 'a_contains':
      case 'a_containedBy':
      case 'a_overlaps': {
        const { name, field } = alias(node.args[0].property, true);
        const list = param(node.args[1] satisfies Value[], listType(field));
        // CQL2 compares the lists as sets.
        if (node.op === 'a_equals') return `(${name} @> ${list} AND ${name} <@ ${list})`;
        return `(${name} ${lookUp(ARRAY_OPERATORS, node.op)} ${list})`;
      }
      default: {
        const { name, field } = alias(node.args[0].property, true);
        return `(${name} ${lookUp(COMPARISONS, node.op)} ${param(node.args[1], SQL_TYPES[field.type])})`;
      }
    }
  };

  const filters = plan.steps.map((step) => condition(step.filter));
  const filter = filters.length === 0 ? 'TRUE' : filters.join(' AND ');
  const comparedFields = fields.filter((field) => compared.has(field.key));
  const recorded =
    comparedFields.length === 0
      ? 'TRUE'
      : comparedFields.map((field) => `${aliases.get(field.key) as string} IS NOT NULL`).join(' AND ');
  const columns = fields.map((field, index) => `,\n           ${normalised(field)} AS f${index + 1}`).join('');

  const sql = `WITH view_area AS (
    SELECT ST_Transform(${envelope}, ${FOOTPRINT_SRID}) AS geom
), scope AS (
    SELECT b.building_id${columns}
      FROM public.buildings AS b
      JOIN public.geometries AS g ON g.geometry_id = b.geometry_id
      CROSS JOIN view_area AS v
     WHERE g.geometry_geom && v.geom
       AND ST_Covers(v.geom, ST_PointOnSurface(g.geometry_geom))
)
SELECT transaction_timestamp() AS as_of,
       count(*) AS spatial_population,
       count(*) FILTER (WHERE ${recorded}) AS recorded_count,
       count(*) FILTER (WHERE (${filter}) IS TRUE) AS confirmed_matches,
       count(*) FILTER (WHERE ${recorded} AND (${filter}) IS TRUE) AS confirmed_matches_among_recorded
  FROM scope`;

  assertAllowedFunctions(sql);
  return { sql, params, fields, comparedFields };
}

function lookUp(table: Readonly<Record<string, string>>, op: string): string {
  const sql = table[op];
  if (sql === undefined) throw new CompileError('The plan uses an operator the compiler does not know');
  return sql;
}

/** The field's column, with blank values (empty text, an empty list) read as SQL null. */
function normalised(field: Field): string {
  const column = `b.${pg.escapeIdentifier(field.key)}`;
  const type = SQL_TYPES[field.type];
  const cast = type === null ? '' : `::${type}${field.multiValued ? '[]' : ''}`;
  if (field.multiValued) return `CASE WHEN cardinality(${column}) > 0 THEN ${column}${cast} END`;
  if (field.type === 'text') return `NULLIF(${column}::text, '')`;
  return `${column}${cast}`;
}

function assertAllowedFunctions(sql: string): void {
  for (const [, name] of sql.matchAll(/\b(ST_\w+)\s*\(/gi)) {
    if (!ALLOWED_POSTGIS_FUNCTIONS.includes(name as string)) {
      throw new CompileError('The compiler wrote a PostGIS function outside its allow-list');
    }
  }
}
