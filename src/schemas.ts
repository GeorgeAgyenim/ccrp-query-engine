// The published JSON Schemas (schemas/*.schema.json) and their validators. The schemas are the
// contract hosts build against: the plan format, the catalogue file format and the API's bodies.
// The TypeScript types in schemas/query-engine.d.ts are generated from them (npm run types).

import { readFileSync } from 'node:fs';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';

const SCHEMAS_DIRECTORY = new URL('../schemas/', import.meta.url);

export const SCHEMA_FILES = ['plan-1.schema.json', 'catalogue-1.schema.json', 'api-1.schema.json'] as const;

export type JsonSchema = Record<string, unknown>;

/** Reads a published schema from schemas/. */
export function readSchema(file: (typeof SCHEMA_FILES)[number]): JsonSchema {
  return JSON.parse(readFileSync(new URL(file, SCHEMAS_DIRECTORY), 'utf8')) as JsonSchema;
}

export const PLAN_SCHEMA = readSchema('plan-1.schema.json');
export const CATALOGUE_SCHEMA = readSchema('catalogue-1.schema.json');
export const API_SCHEMA = readSchema('api-1.schema.json');

/** The plan format versions this engine runs, from the plan schema. */
export const PLAN_VERSIONS = ((PLAN_SCHEMA['properties'] as Record<string, { enum: string[] }>)['version'] as {
  enum: string[];
}).enum;
/** The newest plan format version this engine runs. */
export const PLAN_VERSION = PLAN_VERSIONS.at(-1) as string;
/** The catalogue format versions this engine reads. */
export const CATALOGUE_VERSIONS = (
  (CATALOGUE_SCHEMA['properties'] as Record<string, { enum: string[] }>)['formatVersion'] as { enum: string[] }
).enum;
export const CATALOGUE_VERSION = CATALOGUE_VERSIONS.at(-1) as string;

// allowUnionTypes: the schemas use type lists such as ["string", "number", "boolean"] on purpose.
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, schemas: [PLAN_SCHEMA, CATALOGUE_SCHEMA, API_SCHEMA] });

function validator(ref: string): ValidateFunction {
  const validate = ajv.getSchema(ref);
  if (validate === undefined) throw new Error(`No schema ${ref}`);
  return validate;
}

export const validatePlanShape = validator(PLAN_SCHEMA['$id'] as string);
export const validateCatalogueShape = validator(CATALOGUE_SCHEMA['$id'] as string);

/** A validator for one of the API's bodies, by its name in api-1.schema.json's $defs. */
export function apiValidator(name: string): ValidateFunction {
  return validator(`${API_SCHEMA['$id'] as string}#/$defs/${name}`);
}

/** One schema error as text: where, and what the schema says (no sent value is repeated). */
export function describeSchemaError(error: ErrorObject): string {
  return `${error.instancePath === '' ? 'the top level' : error.instancePath} ${error.message ?? 'is not valid'}`;
}
