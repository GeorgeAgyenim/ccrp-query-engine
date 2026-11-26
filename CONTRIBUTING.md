# Contributing

Thank you for helping. Every change follows the rules below. The [glossary](CONTEXT.md) defines the terms used
in code, tests and docs.

## Safety rules

This repository is **public**. Every commit, fixture, doc, issue and log line is published.

- **No instance data**: no host's building records, counts, place names, settings values, credentials or
  personal data, anywhere. Fixtures are hand-made synthetic data (see `test/fixtures/`: made-up squares at
  0°N 0°E, `example.invalid` addresses).
- **Instance-neutral code**: the code names no instance. Instance facts arrive as configuration and data.
- **Parameters only**: SQL takes values as `$1` parameters. Identifiers come from the code, the field
  catalogue or, later, the layer registry; DDL that cannot take parameters quotes with `escapeIdentifier`.
- **Least privilege**: the service reads through its engine login and the executor only
  (`src/executor.ts`). A change that needs more database access changes the migration grants and
  [ADR-0007](docs/decisions/0007-engine-schema-role-and-migrations.md) first.
- **Safe logs** ([ADR-0008](docs/decisions/0008-log-errors-without-personal-data.md)): log errors with
  `describeError` (`src/safe-log.ts`): name, code, stack frames. Request logs carry method, route pattern,
  status and duration. What a person sent, their address, the database URLs and database messages stay
  out. One exception: the migrate command shows the operator the database's message for a failed
  migration statement, which describes the engine's own DDL.
- **Failing tests get fixed**: a red test is a finding. Fix the code, or the test if it is wrong, and say
  which.

## Conventions

- Node 26 runs the `.ts` sources directly; `tsc` only type-checks. So: erasable TypeScript only (no enums,
  namespaces or parameter properties), and local imports end in `.ts`.
- Dependencies are exact versions. Add one only when the standard library or an existing dependency cannot
  do the job, and record it in the [tools inventory](docs/tools-inventory.md).
- Engine migrations: `migrations/NNN.lower-case-words.up.sql` with a matching `.down.sql`. A migration that
  creates a table in `query_engine` grants `SELECT` on it to `query_engine_reader` (a test checks).
- Settings are `QUERY_ENGINE_*` environment variables, read only in `src/settings.ts` (messages use its
  name constants) and documented in the [host setup guide](docs/host-setup.md#settings).
- A decision that is hard to reverse (the plan format, the HTTP API, the database schema, a role or setting
  name) gets a decision record in `docs/decisions/` before it is implemented.
- The README stays brief: an overview, status, requirements, setup steps, how to run the tests, and links.
  Everything else goes in `docs/`.

## Tests

How to run them: the [testing guide](docs/testing.md).

- Tests sit at the seams a caller can observe: the service over HTTP and as a process
  (`test/service.test.ts`, the query API in `test/query-api.test.ts`, and how long it takes to answer about
  many buildings in `test/run-time.test.ts`), the executor as the engine login
  (`test/executor.test.ts`), the migrate command and the role's privileges (`test/engine-role.test.ts`), the
  `catalogue` and `check` commands (`test/commands.test.ts`), and the published types file
  (`test/types-file.test.ts`).
- All run against a real PostGIS database. Expected values are hand-written literals.
- New fixtures go in `test/fixtures/<name>.sql` and in the `FIXTURES` list in `scripts/test.ts`. The exception
  is a fixture a test loads into its own copy of the database, so that it does not change what the other tests
  count: `many-buildings.sql` (20,000 buildings) is one. A fixture says, in its header, which buildings it
  holds and why, so expected values can be checked by hand.
- The JSON Schemas in `schemas/` are the published contract. Change one only with its decision record, then
  run `npm run types`.
- The test database is built from colouring-core's migrations at the commit pinned in
  `scripts/core-migrations.ts`. Changing that commit means updating the tools inventory too.

## Branches

Work on a branch off `main`, named for its ticket:

- `feature/<NN>-<slug>` for new work, for example `feature/01-test-db-ci-engine-role`;
- `fix/<NN>-<slug>` for a bug fix.

`NN` is the query-engine ticket number, zero-padded to two digits; `<slug>` is a few lower-case words joined
by hyphens. Never commit straight to `main`.

## Commits

- One logical change per commit.
- Subject in the imperative, stating intent, completing "If applied, this commit will ___", for example
  `Run every engine query in a read-only transaction with a statement timeout`. No `feat:`/`fix:` prefixes.
- A body when the why is not obvious from the subject.
- The body's last line cites the ticket, the requirement IDs and the decision records the change serves, for
  example `query-engine ticket 01. FR-1.4, FR-1.6. ADR-0001, ADR-0007.`

## Pull requests

- The title or first line cites `query-engine ticket NN`.
- `npm run typecheck` and `npm test` pass (CI runs both, plus the image build).
- Docs change in the same pull request as the code: the [API reference](docs/api-reference.md), the
  [host setup guide](docs/host-setup.md), the [changelog](CHANGELOG.md) under *Unreleased*, and the
  [tools inventory](docs/tools-inventory.md) for any new or changed dependency.

## Licence

By contributing you agree that your contribution is licensed under [GPL-3.0](LICENSE).
