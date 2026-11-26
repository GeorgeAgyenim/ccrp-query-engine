# Tools inventory

Every tool and dependency the engine uses, with its version, licence, why it was chosen and what was rejected.
Add a row in the same change that adds a dependency; update the row when a version changes. Exact versions
are pinned in `package.json`, `package-lock.json`, `.nvmrc`, `Dockerfile` and the CI workflow.

Last checked: 2026-11-26.

## Runtime and language

| Tool | Version | Licence | Role | Alternatives rejected |
|---|---|---|---|---|
| Node.js | 26.13.1 | MIT | Runs the service, CLI and tests. Checked against the Node.js release schedule (`nodejs/Release`, `schedule.json`) on 2026-11-26: v26 "Lithium" is Active LTS since 2026-10-28, maintenance from 2027-10-20, end of life 2029-04-30. 26.13.1 was released 2026-11-10. Runs `.ts` files directly by stripping types (on by default, no warning, verified on 26.13.1), so there is no build step | Node 24 "Krypton": maintenance LTS since 2026-10-20, so an earlier upgrade. Node 22: maintenance LTS. Node 18, colouring-core's runtime: past end of life |
| TypeScript | 7.0.2 | Apache-2.0 | Type-checking only (`npm run typecheck`); emits nothing. The code uses erasable syntax only (`erasableSyntaxOnly`) so Node can strip it | A `tsc` build to `dist/`: an extra step and a second copy of the code to run. `tsx` or `ts-node` loaders: a dependency Node no longer needs. TypeScript 6.0.3: the older JavaScript-based line; 7 is the current stable release |
| npm | 11.20.0 (bundled with Node 26.13.1) | Artistic-2.0 | Package manager; `package-lock.json` (lockfile version 3) is committed and CI installs with `npm ci` | pnpm, Yarn: another tool every contributor must install, for no gain at this size |

## Dependencies

| Package | Version | Licence | Role | Alternatives rejected |
|---|---|---|---|---|
| fastify | 5.12.8 | MIT | HTTP framework: routing, JSON handling, error handling, structured (pino) logs; JSON Schema request validation for the plan API later | Express 5.3.0: familiar from colouring-core, but no built-in request validation or structured logging, so two more dependencies. Hono 4.13: younger on Node. `node:http` alone: routing, parsing and error handling by hand |
| ajv | 8.20.0 | MIT | Validates plans and catalogue files against the published JSON Schemas (2020-12 dialect, `ajv/dist/2020.js`), so no plan the schema rejects can run. Already installed through fastify at the same version; now a direct dependency | Hand-written shape checks only: the published schema and the engine could disagree. `@cfworker/json-schema`: another package for what fastify already brings |
| pg (node-postgres) | 8.23.1 | MIT | PostgreSQL client. Values travel as server-side parameters (`$1`), and the extended protocol is forced so a query is one statement | pg-promise 12.9.0 (colouring-core's): formats values into the SQL text on the client. postgres.js 4.1.1 (Unlicense): tagged-template API, less familiar to contributors |
| @types/node | 26.6.6 | MIT | Node type definitions (development only) | none |
| @types/pg | 8.23.1 | MIT | pg type definitions (development only) | none |

`npm audit` reported 0 vulnerabilities on 2026-11-26.

## Testing

| Tool | Version | Licence | Role | Alternatives rejected |
|---|---|---|---|---|
| `node:test` | built into Node 26.13.1 | MIT | Test runner and assertions; runs `.ts` tests directly | Vitest 5.1.2: a large dependency tree (Vite) for features not needed. Jest (colouring-core's): needs a transform for TypeScript ES modules |
| PostgreSQL + PostGIS | 18 + 3.6, image `postgis/postgis:18-3.6` | PostgreSQL licence; GPL-2.0 (PostGIS) | The throwaway test database, locally and in CI. PostgreSQL 18 with PostGIS 3 matches the first host's production database (its deployment guide, checked 2026-11-26) | `postgis/postgis:18-3.7`: PostGIS 3.7.0 was two days old (2026-11-24). Mocking the database: would test none of the spatial or permission behaviour |
| colouring-core | commit `cd5fc563255aa06c01044c0c7d411878ac1d3124` (master, 2026-11-26) | GPL-3.0 | Its `migrations/` build the test database, proving the host contract against core itself. Fetched by `npm test` with git into `.cache/` (sparse, one commit); pinned in `scripts/core-migrations.ts` | Vendoring core's migrations: a copy to keep in step by hand. Downloading a tarball: no integrity check equivalent to the commit hash |
| psql | any PostgreSQL client from 13 | PostgreSQL licence | Applies colouring-core's migrations the way core's README does (`ON_ERROR_STOP` off; one known, listed error in 007) | Sending each file through `pg`: a failing statement would abort the whole file, unlike core's own procedure |
| git | any recent | GPL-2.0 | Fetches colouring-core at the pinned commit | none |
| Docker | any recent | Apache-2.0 | Runs the local test database; builds the image | none |

## Container and CI

| Tool | Version | Licence | Role | Alternatives rejected |
|---|---|---|---|---|
| Base image | `node:26.13.1-trixie-slim` (Debian 13) | MIT (image); Debian licences | The service image | Alpine (`26.13.1-alpine`): musl libc, a second platform to support. Full `trixie`: larger, nothing needed from it |
| actions/checkout | v7.0.1, pinned to commit `3d3c42e5aac5ba805825da76410c181273ba90b1` | MIT | CI checkout | none |
| actions/setup-node | v7.1.0, pinned to commit `949feb2413d6458794dcd2491c4babbbce0c15c1` | MIT | CI Node install from `.nvmrc`, npm cache | none |
| GitHub Actions runner | `ubuntu-24.04` | n/a | CI host | none |
| actionlint | 1.7.7 (run with Docker, not a dependency) | MIT | Lints the CI workflow before commit | none |

## Build scripts

| Tool | Version | Licence | Role | Alternatives rejected |
|---|---|---|---|---|
| `scripts/generate-types.ts` | in this repository | GPL-3.0 | Writes `schemas/query-engine.d.ts` from the JSON Schemas (`npm run types`); handles only the keywords the schemas use and stops on any other. A test fails when the committed file is out of date | json-schema-to-typescript 16.0.0 (MIT): eight dependencies including prettier, lodash and js-yaml, and built around JSON Schema draft 4 rather than 2020-12 (`prefixItems`) |
