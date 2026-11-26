// Everything the service checks before serving, shared with the check command: the database
// (layout, migrations, restricted login; src/layout-check.ts) and the field catalogue (the file
// is valid, and its fields are buildings columns of the right type). Each problem is a plain
// sentence; it may name tables, columns, types and catalogue keys and titles, never a building's
// data or a database message.

import {
  checkFieldColumns,
  readBuildingColumns,
  readCatalogueFile,
  type BuildingColumn,
  type FieldCatalogue,
} from './catalogue.ts';
import { connectionProblem } from './connection-problems.ts';
import type { Executor } from './executor.ts';
import { checkDatabase, checkLayout } from './layout-check.ts';
import { describeError } from './safe-log.ts';
import { SETTING_NAMES } from './settings.ts';

export interface StartupCheck {
  problems: string[];
  /** Undefined when the catalogue file is unreadable or invalid. */
  catalogue: FieldCatalogue | undefined;
  /** public.buildings' columns; empty when the check could not read them. */
  columns: BuildingColumn[];
}

/**
 * `service`: everything the service needs (layout, migrations, a restricted login) and the
 * catalogue. `schema`: for the check command in a host's CI, only what depends on the host's
 * schema and catalogue (layout and catalogue), so it runs with any login on a database built
 * from the host's migrations alone.
 */
export type CheckScope = 'service' | 'schema';

export async function runStartupCheck(executor: Executor, catalogueFile: string, scope: CheckScope): Promise<StartupCheck> {
  const loaded = await readCatalogueFile(catalogueFile, SETTING_NAMES.catalogueFile);
  const problems = loaded.ok ? [] : [...loaded.problems];
  const catalogue = loaded.ok ? loaded.catalogue : undefined;
  let columns: BuildingColumn[] = [];
  try {
    problems.push(...(await (scope === 'service' ? checkDatabase(executor) : checkLayout(executor))));
    columns = await executor.read((query) => readBuildingColumns(query));
    // Without the buildings table, checkDatabase has said so; every field would repeat it.
    if (catalogue !== undefined && columns.length > 0) problems.push(...checkFieldColumns(catalogue, columns));
  } catch (error) {
    problems.push(checkFailure(error));
  }
  return { problems, catalogue, columns };
}

// A failure of the check itself, described the way logs describe errors: by name and code,
// with the message only for the engine's own errors.
function checkFailure(error: unknown): string {
  const connection = connectionProblem(error, SETTING_NAMES.databaseUrl);
  if (connection !== undefined) return connection;
  const { name, code, message } = describeError(error);
  return (
    `the start-up check could not finish: ${name}${code === undefined ? '' : ` (${code})`}` +
    `${message === undefined ? '' : `: ${message}`}. See docs/host-setup.md.`
  );
}
