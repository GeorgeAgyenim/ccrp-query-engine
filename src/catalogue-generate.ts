// Builds a catalogue file (catalogue format 1.0.0) from a host's field definitions and its
// buildings columns. Run by `node src/cli.ts catalogue`. Deterministic: the same definitions and
// schema give the same file, so a host can regenerate and compare in CI.
// See docs/decisions/0009-field-catalogue-file-format-and-commands.md.

import type { Catalogue, ExcludedColumn, Field } from '../schemas/query-engine.d.ts';
import { columnFieldType, valueFitsType, type BuildingColumn } from './catalogue.ts';
import { DefinitionsError, type FieldDefinition, type FieldDefinitions } from './field-definitions.ts';
import { CATALOGUE_VERSION } from './schemas.ts';

export interface GeneratedCatalogue {
  catalogue: Catalogue;
  /** Definitions with no buildings column (colouring-core's uprns, say): not part of the file. */
  definitionsWithoutColumn: string[];
}

export function generateCatalogue(
  definitions: FieldDefinitions,
  columns: readonly BuildingColumn[],
  engineVersion: string,
): GeneratedCatalogue {
  const categories = new Set(definitions.categories.map((category) => category.key));
  const byKey = new Map(definitions.fields.map((definition) => [definition.key, definition]));
  const fields = new Map<string, Field>();
  const excludedColumns: ExcludedColumn[] = [];

  for (const column of columns) {
    const definition = byKey.get(column.name);
    const outcome = definition === undefined ? 'It has no field definition.' : fieldFor(definition, column, categories);
    if (typeof outcome === 'string') excludedColumns.push({ column: column.name, reason: outcome });
    else fields.set(outcome.key, outcome);
  }

  const columnNames = new Set(columns.map((column) => column.name));
  return {
    catalogue: {
      formatVersion: CATALOGUE_VERSION as Catalogue['formatVersion'],
      generatedBy: `ccrp-query-engine ${engineVersion} catalogue command`,
      categories: definitions.categories,
      // Definition order: the host's own order within each category.
      fields: definitions.fields.flatMap((definition) => fields.get(definition.key) ?? []),
      excludedColumns: excludedColumns.sort((a, b) => (a.column < b.column ? -1 : a.column > b.column ? 1 : 0)),
    },
    definitionsWithoutColumn: definitions.fields.map((definition) => definition.key).filter((key) => !columnNames.has(key)),
  };
}

/** The field for a defined column, or the reason it is excluded. */
function fieldFor(definition: FieldDefinition, column: BuildingColumn, categories: ReadonlySet<string>): Field | string {
  if (definition.perUser) return 'Its definition is per user, not per building.';
  if (definition.structured) return 'Its definition describes nested values, which plan format 1 cannot query.';
  const type = columnFieldType(column);
  if (!type.supported) return type.reason;
  // A field the engine would offer must be read exactly; never guess its title or values.
  if (definition.problem !== null) throw new DefinitionsError(definition.problem);
  const category = definition.category as string;
  if (!categories.has(category)) return `Its category (${category}) is not one of the defined categories.`;

  let allowedValues: Field['allowedValues'] = null;
  if (definition.items !== null && definition.items.length > 0) {
    if (type.type === 'boolean' || !definition.items.every((item) => valueFitsType(item, type.type))) {
      return `Its allowed values do not fit its column type (${column.declaredType}).`;
    }
    allowedValues = [...new Set(definition.items as Array<string | number>)];
  }

  return {
    key: column.name,
    category,
    title: definition.title as string,
    type: type.type,
    multiValued: type.multiValued,
    allowedValues,
    ambiguity: ambiguity(column),
  };
}

/**
 * A column with a database default may hold that default for buildings nobody described, so
 * a stored value is not known to be an observation. Defaults the engine already reads as blank
 * (empty text, an empty list) are not ambiguous.
 */
function ambiguity(column: BuildingColumn): string | null {
  if (column.defaultExpression === null) return null;
  // PostgreSQL writes defaults with casts: '0', 'false', '''None''::planning_list_cat', '''{}''::text[]'.
  const value = column.defaultExpression.replace(/::[a-z_ ]+(\[\])?$/i, '');
  if (value === "''" || value === "'{}'") return null;
  const shown = /^'(.*)'$/.exec(value)?.[1]?.replaceAll("''", "'");
  const described = shown === undefined ? value : `"${shown}"`;
  return `The database stores ${described} when nothing is entered, so a recorded ${described} may not be an observation.`;
}
