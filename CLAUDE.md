# CLAUDE.md

Working rules for this repository, for people and AI agents. What the engine is: [README.md](README.md).
Its vocabulary: [CONTEXT.md](CONTEXT.md); use those terms in code, tests and docs.

## Safety rules

This repository is **public**. Every commit, fixture, doc, issue and log line is published.

- **No instance data**: no host's building records, counts, place names, settings values, credentials or
  personal data, anywhere. Fixtures are hand-made synthetic data (see `test/fixtures/`: made-up squares at
  0°N 0°E, `example.invalid` addresses).
- **Instance-neutral code**: the code names no instance. Instance facts arrive as configuration and data.
- **Parameters only**: SQL takes values as `$1` parameters. Identifiers come from the code or, later, the
  field catalogue and layer registry; DDL that cannot take parameters quotes with `escapeIdentifier`.
- **Least privilege**: the service reads through its engine login and the `executor` only
  (`src/executor.ts`). A change that needs more database access changes migration grants and
  [ADR-0007](docs/decisions/0007-engine-schema-role-and-migrations.md) first.
- **Safe logs** ([ADR-0008](docs/decisions/0008-log-errors-without-personal-data.md)): log errors with
  `describeError` (`src/safe-log.ts`): name, code, stack frames. Request logs carry method, route pattern,
  status and duration. What a person sent, their address, the database URLs and database messages stay
  out. One exception: the migrate command shows the operator the database's message for a failed
  migration statement, which describes the engine's own DDL.
- **Failing tests get fixed**: a red test is a finding; fix the code, or the test if it is wrong, and say which.

## Workflow

- Branches, commit messages and pull requests follow [CONTRIBUTING.md](CONTRIBUTING.md); each commit cites
  `query-engine ticket NN`, its requirement IDs and decision records.
- A one-way door (plan format, HTTP API, database schema, role or setting names) gets a decision record in
  `docs/decisions/` before code. Ported records note their origin and link only public documents.
- Docs change with the code, in the same commit or pull request: `docs/api-reference.md` for routes,
  `docs/host-setup.md` for settings, migrations and operator steps, `CHANGELOG.md` under *Unreleased*,
  `docs/tools-inventory.md` for every dependency or pinned version.

## Conventions

- Node 26 runs the `.ts` sources directly; `tsc` only type-checks. So: erasable TypeScript only (no enums,
  namespaces or parameter properties), and local imports end in `.ts`.
- Dependencies are exact versions; add one only when the standard library or an existing dependency cannot
  do the job, and record it in the inventory.
- Engine migrations: `migrations/NNN.lower-case-words.up.sql` with a matching `.down.sql`. A migration that
  creates a table in `query_engine` grants `SELECT` on it to `query_engine_reader` (a test checks).
- Settings are `QUERY_ENGINE_*` environment variables, read only in `src/settings.ts` (messages use its
  name constants) and documented in `docs/host-setup.md#settings`.

## Testing

How to run the suite: [docs/testing.md](docs/testing.md). Keep README.md brief: a short overview of
the repo, its status, requirements, the steps to set it up with a platform, how to run the tests, and links.
Product reasoning, testing detail, implementation notes and working notes belong in docs/, never in the README.

Tests sit at the seams a caller can observe: the service over HTTP and as a process (`test/service.test.ts`),
the executor as the engine login (`test/executor.test.ts`), the migrate command and the role's privileges
(`test/engine-role.test.ts`). All run against a real PostGIS database; expected values are hand-written
literals.

`npm test` needs `QUERY_ENGINE_TEST_ADMIN_URL`, a superuser URL on a disposable PostGIS server
([docs/testing.md](docs/testing.md) shows a Docker one). It builds the database from colouring-core's migrations at the commit pinned in
`scripts/core-migrations.ts`, so changing that commit means updating `docs/tools-inventory.md` too.
`npm test -- <file>` runs one file. New fixtures go in `test/fixtures/<name>.sql` and in the `FIXTURES` list
in `scripts/test.ts`.
