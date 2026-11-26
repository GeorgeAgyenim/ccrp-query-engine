# ccrp-query-engine

Map-grounded spatial query engine and assistant for Colouring Cities (CCRP) platforms.

A person asks a spatial question about buildings, by clicking in a builder or typing in English, about an
area taken from the map: a district, the current view, the selected building or shapes they draw. The engine
answers in a way that is checked and honest about missing data: every answer says how many buildings were in
scope, how many had the queried details recorded, how many matched, and when the data was read. Any
colouring-core instance can run it next to its own platform, pointed at its own database and field
definitions, and build its own screens from the [UI integration guide](docs/ui-integration-guide.md).

## Status

**Pre-release.** What exists: the service with its health endpoint, the start-up check, the engine's
read-only database role, and the test database. Plans, answers and the assistant arrive in later releases;
see the [changelog](CHANGELOG.md).

## Licence

[GPL-3.0](LICENSE), the same licence as colouring-core.

## Run

Needs Node.js 26.13.1 (`.nvmrc`; `nvm use` picks it up) and a colouring-core PostgreSQL/PostGIS database.

```sh
npm ci
QUERY_ENGINE_MIGRATION_DATABASE_URL='postgres://<owner>:<password>@<host>:5432/<database>' npm run migrate -- up
QUERY_ENGINE_DATABASE_URL='postgres://<engine login>:<password>@<host>:5432/<database>' npm start
curl http://127.0.0.1:3100/health    # {"status":"ok"}
```

The engine needs its own restricted login, and refuses to start without one. The
[host setup guide](docs/host-setup.md) explains the login, every setting, the container image and the
compose example.

## Test

`npm test` builds a throwaway database from colouring-core's migrations at a pinned commit, applies the
engine's migrations, loads synthetic fixtures, runs the suite and drops the database. It needs a disposable
PostGIS server with a superuser it can use, `psql` on the `PATH`, git and network access to GitHub (once,
to fetch colouring-core into `.cache/`).

Start a local server with Docker, reachable only from this machine:

```sh
docker run -d --name ccrp-query-engine-test-db \
  -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:55432:5432 postgis/postgis:18-3.6
```

Then:

```sh
export QUERY_ENGINE_TEST_ADMIN_URL=postgres://postgres@127.0.0.1:55432/postgres
npm run typecheck
npm test                               # the whole suite
npm test -- test/executor.test.ts      # one file
```

Expected first line, then the `node:test` report:

```
Test database ready in 2.6 s: colouring-core cd5fc563 (59 migrations), engine migrations 001.engine-schema-and-reader-role, fixtures buildings, host-private-tables.
```

Without `QUERY_ENGINE_TEST_ADMIN_URL` the command fails; it never skips the suite. CI runs the same command
against a PostGIS service container (`.github/workflows/ci.yml`).

## Documentation

- [Host setup guide](docs/host-setup.md): running the engine for a CCRP instance
- [API reference](docs/api-reference.md)
- [UI integration guide](docs/ui-integration-guide.md)
- [Decision records](docs/decisions/README.md)
- [Glossary](CONTEXT.md)
- [Tools inventory](docs/tools-inventory.md): versions, licences and alternatives
- [Contributing](CONTRIBUTING.md) and [CLAUDE.md](CLAUDE.md) (working rules, also for AI agents)
- [Changelog](CHANGELOG.md)
