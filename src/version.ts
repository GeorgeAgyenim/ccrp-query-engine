// The engine's version, from package.json: written into generated catalogues and the types file.

import { readFileSync } from 'node:fs';

export function engineVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return manifest.version;
}
