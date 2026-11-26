// What may be logged about an error: never what someone sent or who they are.
//
// A PostgreSQL error's message, detail and position can repeat a value from the query, and a
// connection error can name the login. So an error is described by an allow-list: its name,
// its code when that is a short identifier, and its stack frames. The message is included
// only for the engine's own error classes, whose messages never contain a sent value.

export interface ErrorDescription {
  name: string;
  code?: string;
  message?: string;
  stack?: string[];
}

/** Errors whose messages the engine writes itself and keeps free of sent values. */
export class EngineError extends Error {
  override name = 'EngineError';
}

/** An error's code (a PostgreSQL SQLSTATE such as 42501, or a Node code such as ECONNREFUSED), when it is a short identifier. */
export function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : undefined;
}

export function describeError(error: unknown): ErrorDescription {
  if (!(error instanceof Error)) return { name: typeof error };
  const description: ErrorDescription = { name: error.name };
  const code = errorCode(error);
  if (code !== undefined) description.code = code;
  if (error instanceof EngineError) description.message = error.message;
  const frames = (error.stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '));
  if (frames.length > 0) description.stack = frames;
  return description;
}
