// Operator commands. Usage:
//   node src/cli.ts migrate up       apply every pending engine migration
//   node src/cli.ts migrate down     revert the most recent engine migration
//   node src/cli.ts migrate status   list applied and pending engine migrations
//   node src/cli.ts catalogue --definitions <data-fields-config.ts> --output <catalogue.json>
//                                    write the field catalogue from the host's field definitions
//   node src/cli.ts check            for a host's CI: the buildings layout and the catalogue match
//                                    the database, and every buildings column is in the catalogue
//                                    or on its exclusion list
//
// Migrations run with QUERY_ENGINE_MIGRATION_DATABASE_URL, a login that owns the host's
// buildings and geometries tables and can create roles. The service never uses it.
// catalogue reads column types with QUERY_ENGINE_DATABASE_URL; check reads it and
// QUERY_ENGINE_CATALOGUE_FILE, and works with any login on a database built from the host's
// own migrations.
// See docs/host-setup.md.

import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { checkCatalogue, checkColumnsCovered, readBuildingColumns } from './catalogue.ts';
import { generateCatalogue } from './catalogue-generate.ts';
import { connectionProblem } from './connection-problems.ts';
import { createExecutor } from './executor.ts';
import { DefinitionsError, readFieldDefinitions } from './field-definitions.ts';
import { MigrationError, migrateDown, migrateUp, migrationStatus } from './migrations.ts';
import { describeError, errorCode } from './safe-log.ts';
import {
  MIGRATION_DATABASE_URL,
  SETTING_NAMES,
  readCheckSettings,
  readDatabaseSettings,
  readMigrationSettings,
} from './settings.ts';
import { runStartupCheck } from './startup-check.ts';
import { engineVersion } from './version.ts';

const USAGE = [
  'Usage:',
  '  node src/cli.ts migrate up|down|status',
  '  node src/cli.ts catalogue --definitions <data-fields-config.ts> --output <catalogue.json>',
  '  node src/cli.ts check',
].join('\n');

async function main(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  if (command === 'migrate') return migrate(rest);
  if (command === 'catalogue') return catalogue(rest);
  if (command === 'check' && rest.length === 0) return check();
  console.error(USAGE);
  return 2;
}

async function migrate([action, ...extra]: string[]): Promise<number> {
  if ((action !== 'up' && action !== 'down' && action !== 'status') || extra.length > 0) {
    console.error(USAGE);
    return 2;
  }
  const settings = readMigrationSettings(process.env);
  if (!settings.ok) {
    console.error(settings.problem);
    return 1;
  }

  if (action === 'up') {
    const applied = await migrateUp(settings.databaseUrl);
    console.log(applied.length === 0 ? 'Nothing to apply: the database is up to date.' : `Applied ${applied.join(', ')}.`);
  } else if (action === 'down') {
    const reverted = await migrateDown(settings.databaseUrl);
    console.log(reverted === null ? 'Nothing to revert: no engine migration is applied.' : `Reverted ${reverted}.`);
  } else {
    const status = await migrationStatus(settings.databaseUrl);
    console.log(`Applied: ${status.applied.join(', ') || 'none'}`);
    console.log(`Pending: ${status.pending.join(', ') || 'none'}`);
  }
  return 0;
}

async function catalogue(args: string[]): Promise<number> {
  let values: { definitions?: string; output?: string };
  try {
    ({ values } = parseArgs({ args, options: { definitions: { type: 'string' }, output: { type: 'string' } } }));
  } catch {
    console.error(USAGE);
    return 2;
  }
  if (values.definitions === undefined || values.output === undefined) {
    console.error(USAGE);
    return 2;
  }
  const settings = readDatabaseSettings(process.env);
  if (!settings.ok) {
    console.error(settings.problems.join('\n'));
    return 1;
  }

  const definitions = readFieldDefinitions(values.definitions);
  const executor = createExecutor(settings.settings);
  let columns;
  try {
    columns = await executor.read((query) => readBuildingColumns(query));
  } finally {
    await executor.close();
  }
  if (columns.length === 0) {
    console.error(`The database named by ${SETTING_NAMES.databaseUrl} has no table public.buildings.`);
    return 1;
  }

  const generated = generateCatalogue(definitions, columns, engineVersion());
  // Write only a file the service accepts: a definitions module listing a category twice, say,
  // would not give one.
  const checked = checkCatalogue(generated.catalogue, 'The catalogue made from these definitions');
  if (!checked.ok) {
    console.error(['No catalogue was written:', ...checked.problems.map((problem) => `  - ${problem}`)].join('\n'));
    return 1;
  }
  await writeFile(values.output, `${JSON.stringify(generated.catalogue, null, 2)}\n`);

  const { fields, excludedColumns, categories } = generated.catalogue;
  console.log(
    `Wrote ${values.output}: ${fields.length} fields in ${categories.length} categories; ` +
      `${excludedColumns.length} columns excluded, each with its reason.`,
  );
  if (generated.definitionsWithoutColumn.length > 0) {
    console.log(
      `${generated.definitionsWithoutColumn.length} definitions have no buildings column and are not in the ` +
        `catalogue: ${generated.definitionsWithoutColumn.join(', ')}.`,
    );
  }
  return 0;
}

async function check(): Promise<number> {
  const settings = readCheckSettings(process.env);
  if (!settings.ok) {
    console.error(['The query engine check failed:', ...settings.problems.map((problem) => `  - ${problem}`)].join('\n'));
    return 1;
  }
  const executor = createExecutor(settings.settings);
  let result;
  try {
    result = await runStartupCheck(executor, settings.settings.catalogueFile, 'schema');
  } finally {
    await executor.close();
  }
  const problems = [...result.problems];
  if (result.catalogue !== undefined && result.columns.length > 0) {
    problems.push(...checkColumnsCovered(result.catalogue, result.columns));
  }
  if (problems.length > 0) {
    console.error(['The query engine check failed:', ...problems.map((problem) => `  - ${problem}`)].join('\n'));
    return 1;
  }
  const file = result.catalogue?.file;
  console.log(
    `Check passed: the database has colouring-core's buildings and footprint layout, the catalogue's fields ` +
      `match their columns, and all ${result.columns.length} buildings columns are fields ` +
      `(${file?.fields.length ?? 0}) or excluded (${file?.excludedColumns.length ?? 0}) in the catalogue.`,
  );
  return 0;
}

// A failed migration statement is shown with the database's own message: it is the quickest
// way to see why, and it describes the engine's DDL, not anyone's data. A connection failure
// is shown by code only, because its message can name the login. The URL is never printed.
function explain(error: unknown, command: string): string {
  if (error instanceof DefinitionsError) return `Could not read the field definitions: ${error.message}`;
  const connection = connectionProblem(error, command === 'migrate' ? MIGRATION_DATABASE_URL : SETTING_NAMES.databaseUrl);
  if (connection !== undefined) return `Could not run the ${command} command: ${connection}`;
  if (error instanceof MigrationError) {
    const cause = error.cause;
    if (cause === undefined) return error.message;
    const code = errorCode(cause);
    const detail = cause instanceof Error ? cause.message : String(cause);
    return `${error.message}\n  caused by: ${detail}${code === undefined ? '' : ` (${code})`}`;
  }
  const { name, code, message } = describeError(error);
  return `The ${command} command failed: ${name}${code === undefined ? '' : ` (${code})`}${message === undefined ? '' : `: ${message}`}.`;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(explain(error, process.argv[2] ?? ''));
  process.exitCode = 1;
}
