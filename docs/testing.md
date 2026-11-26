# Testing guide

The test suite runs the engine against a real PostGIS database. A fake database would hide the very things the
engine must get right: spatial rules, missing values and database permissions.

## What you need

- Docker, or another PostGIS server you can throw away;
- `psql` on your `PATH`;
- git, and network access to GitHub the first time.

## Run the tests

Start a disposable PostGIS server, reachable only from your machine:

```sh
docker run -d --name ccrp-query-engine-test-db \
  -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:55432:5432 postgis/postgis:18-3.6
```

Then run the checks:

```sh
export QUERY_ENGINE_TEST_ADMIN_URL=postgres://postgres@127.0.0.1:55432/postgres
npm run typecheck
npm test                               # the whole suite
npm test -- test/executor.test.ts      # one file
```

The first line of the output confirms the test database was built. A `node:test` report follows, ending with
the pass and fail counts.

## What a test run does

1. Creates a throwaway database on that server.
2. Builds colouring-core's tables from its own migrations, at the commit pinned in
   `scripts/core-migrations.ts`. The first run downloads colouring-core into `.cache/`.
3. Applies the engine's migrations.
4. Loads small, made-up fixtures from `test/fixtures/`.
5. Runs every test, then drops the database.

If `QUERY_ENGINE_TEST_ADMIN_URL` is not set, the run fails rather than skipping the tests, so a missing
database can never look like a pass.

## Working offline

Set `QUERY_ENGINE_TEST_CORE_REPOSITORY` to a local clone of colouring-core that contains the pinned commit,
and the run uses it instead of GitHub. Once colouring-core has been fetched into `.cache/`, no network is
needed.

## In CI

GitHub Actions runs the same commands against a PostGIS service container, plus the container image build
(`.github/workflows/ci.yml`).
