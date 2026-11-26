// Reads a host's field definitions, colouring-core's
// app/src/frontend/config/data-fields-config.ts, without running them.
//
// The module is parsed as TypeScript and only the values the catalogue needs are evaluated:
// each dataFields entry's category, title and items, and the categories' order and names from
// the module that defines the Category enum (categories-config.ts in colouring-core). The
// evaluator understands literals, + and template strings, arrays, objects, the modules' own
// constants, imported constants and enums, and require() of a .json file. Anything else
// stops with the file and line, so nothing is guessed and no host code runs.
// See docs/decisions/0009-field-catalogue-file-format-and-commands.md.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from '@babel/parser';
import { EngineError } from './safe-log.ts';

/** Its messages name files, lines and field keys from the host's own definitions. */
export class DefinitionsError extends EngineError {
  override name = 'DefinitionsError';
}

export interface FieldDefinition {
  key: string;
  /** Set when the definition's category, title or items cannot be read; the field cannot be catalogued. */
  problem: string | null;
  category: string | null;
  title: string | null;
  /** The definition's items when they are a list of values, else null. */
  items: unknown[] | null;
  /** The definition describes nested values (fields, or items that are definitions). */
  structured: boolean;
  /** The definition is per user (colouring-core's perUser), not per building. */
  perUser: boolean;
}

export interface FieldDefinitions {
  categories: Array<{ key: string; title: string }>;
  /** In definition order. */
  fields: FieldDefinition[];
}

const DATA_FIELDS = 'dataFields';
const CATEGORY_ENUM = 'Category';
const CATEGORIES_ORDER = 'categoriesOrder';
const CATEGORIES_CONFIG = 'categoriesConfig';

/** Reads the definitions module at `path` (data-fields-config.ts). */
export function readFieldDefinitions(path: string): FieldDefinitions {
  const definitions = new ModuleReader(resolve(path), new Map());
  const dataFields = definitions.topLevel(DATA_FIELDS);
  const object = unwrap(dataFields);
  if (object?.type !== 'ObjectExpression') {
    throw new DefinitionsError(`${definitions.file}: no exported object ${DATA_FIELDS} was found.`);
  }

  const fields: FieldDefinition[] = [];
  for (const property of nodes(object['properties'])) {
    const key = propertyKey(property, definitions);
    const value = unwrap(property['value'] as Node | undefined);
    if (property.type !== 'ObjectProperty' || key === undefined || value?.type !== 'ObjectExpression') {
      throw new DefinitionsError(`${definitions.where(property)}: an entry of ${DATA_FIELDS} is not a plain field definition.`);
    }
    fields.push(readDefinition(key, value, definitions));
  }

  const categoryModule = definitions.moduleOfImport(CATEGORY_ENUM);
  return { categories: readCategories(categoryModule), fields };
}

function readDefinition(key: string, definition: Node, reader: ModuleReader): FieldDefinition {
  const members = new Map<string, Node>();
  for (const property of nodes(definition['properties'])) {
    const name = propertyKey(property, reader);
    if (name !== undefined && property['value'] !== undefined) members.set(name, property['value'] as Node);
  }
  const result: FieldDefinition = {
    key,
    problem: null,
    category: null,
    title: null,
    items: null,
    structured: members.has('fields'),
    perUser: false,
  };
  try {
    const perUser = members.get('perUser');
    result.perUser = perUser !== undefined && reader.evaluate(perUser) === true;
    const category = reader.evaluate(required(members, 'category', key, definition, reader));
    const title = reader.evaluate(required(members, 'title', key, definition, reader));
    if (typeof category !== 'string') throw new DefinitionsError(`${reader.where(definition)}: the category of ${key} is not text.`);
    if (typeof title !== 'string') throw new DefinitionsError(`${reader.where(definition)}: the title of ${key} is not text.`);
    result.category = category;
    result.title = title;
    const items = members.get('items');
    if (items !== undefined) {
      const value = reader.evaluate(items);
      if (Array.isArray(value)) result.items = value;
      else if (value !== undefined) result.structured = true;
    }
  } catch (error) {
    if (!(error instanceof DefinitionsError)) throw error;
    result.problem = error.message;
  }
  return result;
}

function required(members: Map<string, Node>, name: string, key: string, definition: Node, reader: ModuleReader): Node {
  const node = members.get(name);
  if (node === undefined) throw new DefinitionsError(`${reader.where(definition)}: the definition of ${key} has no ${name}.`);
  return node;
}

function readCategories(reader: ModuleReader): FieldDefinitions['categories'] {
  const order = reader.evaluate(reader.identifier(CATEGORIES_ORDER));
  const config = reader.evaluate(reader.identifier(CATEGORIES_CONFIG));
  if (!Array.isArray(order) || !order.every((key) => typeof key === 'string')) {
    throw new DefinitionsError(`${reader.file}: ${CATEGORIES_ORDER} is not a list of categories.`);
  }
  if (typeof config !== 'object' || config === null) {
    throw new DefinitionsError(`${reader.file}: ${CATEGORIES_CONFIG} is not an object.`);
  }
  return order.map((key: string) => {
    const name = (config as Record<string, { name?: unknown } | undefined>)[key]?.name;
    if (typeof name !== 'string') {
      throw new DefinitionsError(`${reader.file}: ${CATEGORIES_CONFIG} has no name for the category ${key}.`);
    }
    return { key, title: name };
  });
}

// --- A small, strict evaluator over Babel's AST ---------------------------------------------

interface Node {
  type: string;
  loc?: { start: { line: number } };
  [key: string]: unknown;
}

function nodes(value: unknown): Node[] {
  return Array.isArray(value) ? (value as Node[]) : [];
}

/** Strips TypeScript-only wrappers (as, satisfies, !, <T>) from an expression. */
function unwrap(node: Node | undefined): Node | undefined {
  let current = node;
  while (
    current !== undefined &&
    ['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'ParenthesizedExpression'].includes(
      current.type,
    )
  ) {
    current = current['expression'] as Node;
  }
  return current;
}

function propertyKey(property: Node, reader: ModuleReader): string | undefined {
  const key = property['key'] as Node | undefined;
  if (key === undefined) return undefined;
  if (property['computed'] === true) {
    const value = reader.evaluate(key);
    return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
  }
  if (key.type === 'Identifier') return key['name'] as string;
  if (key.type === 'StringLiteral' || key.type === 'NumericLiteral') return String(key['value']);
  return undefined;
}

type Binding =
  | { kind: 'value'; node: Node }
  | { kind: 'enum'; node: Node }
  | { kind: 'import'; source: string; imported: string; node: Node };

class ModuleReader {
  readonly file: string;
  private readonly bindings = new Map<string, Binding>();
  private readonly evaluating = new Set<string>();
  private readonly cache = new Map<string, unknown>();
  /** Every module read for one set of definitions, by file, shared so each is parsed once. */
  private readonly modules: Map<string, ModuleReader>;

  constructor(file: string, modules: Map<string, ModuleReader>) {
    this.file = file;
    this.modules = modules;
    modules.set(file, this);
    let code: string;
    try {
      code = readFileSync(file, 'utf8');
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      throw new DefinitionsError(`Cannot read ${file} (${typeof code === 'string' ? code : 'error'}).`);
    }
    let program: Node;
    try {
      program = parse(code, { sourceType: 'module', plugins: ['typescript'] }).program as unknown as Node;
    } catch (error) {
      throw new DefinitionsError(`Cannot parse ${file} as TypeScript: ${(error as Error).message}`);
    }
    for (const statement of nodes(program['body'])) {
      const declaration = statement.type === 'ExportNamedDeclaration' ? (statement['declaration'] as Node | null) : statement;
      if (declaration === null || declaration === undefined) continue;
      if (declaration.type === 'VariableDeclaration') {
        for (const declarator of nodes(declaration['declarations'])) {
          const id = declarator['id'] as Node;
          if (id.type === 'Identifier' && declarator['init'] != null) {
            this.bindings.set(id['name'] as string, { kind: 'value', node: declarator['init'] as Node });
          }
        }
      } else if (declaration.type === 'TSEnumDeclaration') {
        this.bindings.set((declaration['id'] as Node)['name'] as string, { kind: 'enum', node: declaration });
      } else if (declaration.type === 'ImportDeclaration') {
        const source = (declaration['source'] as Node)['value'] as string;
        for (const specifier of nodes(declaration['specifiers'])) {
          if (specifier.type !== 'ImportSpecifier') continue;
          const imported = specifier['imported'] as Node;
          const local = (specifier['local'] as Node)['name'] as string;
          const importedName = imported.type === 'Identifier' ? (imported['name'] as string) : String(imported['value']);
          this.bindings.set(local, { kind: 'import', source, imported: importedName, node: specifier });
        }
      }
    }
  }

  private load(file: string): ModuleReader {
    return this.modules.get(file) ?? new ModuleReader(file, this.modules);
  }

  where(node: Node): string {
    return `${this.file}:${node.loc?.start.line ?? '?'}`;
  }

  /** The initialiser of a top-level constant, or undefined. */
  topLevel(name: string): Node | undefined {
    const binding = this.bindings.get(name);
    return binding?.kind === 'value' ? binding.node : undefined;
  }

  /** A synthetic identifier node for a top-level name, to evaluate it. */
  identifier(name: string): Node {
    if (!this.bindings.has(name)) throw new DefinitionsError(`${this.file}: no top-level ${name} was found.`);
    return { type: 'Identifier', name };
  }

  /** The module an imported name comes from. */
  moduleOfImport(name: string): ModuleReader {
    const binding = this.bindings.get(name);
    if (binding?.kind !== 'import') throw new DefinitionsError(`${this.file}: ${name} is not imported.`);
    return this.load(this.resolveImport(binding.source, binding.node));
  }

  private resolveImport(source: string, node: Node): string {
    if (!source.startsWith('.')) {
      throw new DefinitionsError(`${this.where(node)}: only relative imports can be read (${source}).`);
    }
    const base = resolve(dirname(this.file), source);
    const candidate = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')].find(
      (path) => existsSync(path) && statSync(path).isFile(),
    );
    if (candidate === undefined) throw new DefinitionsError(`${this.where(node)}: cannot find the module ${source}.`);
    return candidate;
  }

  evaluate(node: Node): unknown {
    const expression = unwrap(node) as Node;
    switch (expression.type) {
      case 'StringLiteral':
      case 'NumericLiteral':
      case 'BooleanLiteral':
        return expression['value'];
      case 'NullLiteral':
        return null;
      case 'TemplateLiteral': {
        const quasis = nodes(expression['quasis']);
        const values = nodes(expression['expressions']).map((part) => this.evaluate(part));
        return quasis
          .map((quasi, index) => `${(quasi['value'] as { cooked: string }).cooked}${index < values.length ? String(values[index]) : ''}`)
          .join('');
      }
      case 'BinaryExpression': {
        if (expression['operator'] !== '+') break;
        const left = this.evaluate(expression['left'] as Node);
        const right = this.evaluate(expression['right'] as Node);
        if (typeof left === 'string' || typeof right === 'string') return `${String(left)}${String(right)}`;
        if (typeof left === 'number' && typeof right === 'number') return left + right;
        break;
      }
      case 'UnaryExpression': {
        const argument = this.evaluate(expression['argument'] as Node);
        if (expression['operator'] === '-' && typeof argument === 'number') return -argument;
        break;
      }
      case 'ArrayExpression': {
        const values: unknown[] = [];
        for (const element of nodes(expression['elements'])) {
          if (element === null) {
            throw new DefinitionsError(`${this.where(expression)}: the catalogue command cannot read a list with holes.`);
          }
          if (element.type !== 'SpreadElement') {
            values.push(this.evaluate(element));
            continue;
          }
          const spread = this.evaluate(element['argument'] as Node);
          if (!Array.isArray(spread)) {
            throw new DefinitionsError(`${this.where(element)}: the catalogue command can only spread a list into a list.`);
          }
          values.push(...spread);
        }
        return values;
      }
      case 'ObjectExpression': {
        const value: Record<string, unknown> = {};
        for (const property of nodes(expression['properties'])) {
          if (property.type === 'SpreadElement') {
            Object.assign(value, this.evaluate(property['argument'] as Node));
            continue;
          }
          const key = propertyKey(property, this);
          if (property.type !== 'ObjectProperty' || key === undefined) {
            throw new DefinitionsError(`${this.where(property)}: the catalogue command cannot read this object member.`);
          }
          value[key] = this.evaluate(property['value'] as Node);
        }
        return value;
      }
      case 'Identifier':
        return this.evaluateName(expression);
      case 'MemberExpression': {
        const object = this.evaluate(expression['object'] as Node);
        const property = expression['property'] as Node;
        const key =
          expression['computed'] === true
            ? this.evaluate(property)
            : property.type === 'Identifier'
              ? (property['name'] as string)
              : undefined;
        if (typeof object === 'object' && object !== null && (typeof key === 'string' || typeof key === 'number')) {
          if (!Object.hasOwn(object, key)) {
            throw new DefinitionsError(`${this.where(expression)}: ${String(key)} is not defined there, so the value cannot be read.`);
          }
          return (object as Record<string, unknown>)[key];
        }
        break;
      }
      case 'CallExpression': {
        const callee = expression['callee'] as Node;
        const args = nodes(expression['arguments']);
        const [first] = args;
        if (
          callee.type === 'Identifier' && callee['name'] === 'require' && args.length === 1 &&
          first?.type === 'StringLiteral' && String(first['value']).endsWith('.json')
        ) {
          return this.readJson(String(first['value']), expression);
        }
        break;
      }
    }
    throw new DefinitionsError(
      `${this.where(expression)}: the catalogue command cannot read this expression (${expression.type}). ` +
        'It reads literals, + and template strings, arrays, objects, constants, enums and require() of a .json file.',
    );
  }

  private evaluateName(identifier: Node): unknown {
    const name = identifier['name'] as string;
    if (name === 'undefined') return undefined;
    if (this.cache.has(name)) return this.cache.get(name);
    const binding = this.bindings.get(name);
    if (binding === undefined) {
      throw new DefinitionsError(`${this.where(identifier)}: ${name} is not a top-level constant, enum or import of this module.`);
    }
    if (this.evaluating.has(name)) throw new DefinitionsError(`${this.where(identifier)}: ${name} refers to itself.`);
    this.evaluating.add(name);
    try {
      let value: unknown;
      if (binding.kind === 'value') value = this.evaluate(binding.node);
      else if (binding.kind === 'enum') value = this.evaluateEnum(binding.node);
      else value = this.evaluateImport(binding);
      this.cache.set(name, value);
      return value;
    } finally {
      this.evaluating.delete(name);
    }
  }

  private evaluateEnum(declaration: Node): Record<string, unknown> {
    const body = declaration['body'] as Node | undefined;
    const members = nodes(body?.['members'] ?? declaration['members']);
    const value: Record<string, unknown> = {};
    for (const member of members) {
      const id = member['id'] as Node;
      const key = id.type === 'Identifier' ? (id['name'] as string) : String(id['value']);
      if (member['initializer'] == null) {
        throw new DefinitionsError(`${this.where(member)}: enum member ${key} has no value; the catalogue command reads string enums.`);
      }
      value[key] = this.evaluate(member['initializer'] as Node);
    }
    return value;
  }

  private evaluateImport(binding: Extract<Binding, { kind: 'import' }>): unknown {
    const module = this.load(this.resolveImport(binding.source, binding.node));
    return module.evaluate(module.identifier(binding.imported));
  }

  private readJson(source: string, node: Node): unknown {
    const path = resolve(dirname(this.file), source);
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new DefinitionsError(`${this.where(node)}: cannot read the JSON file ${source}.`);
    }
  }
}
