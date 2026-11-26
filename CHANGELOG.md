# Changelog

Notable changes to the engine, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0.0 any release may change the API or the
settings; each change is listed here with what a host must do.

## [Unreleased]

### Added

- The service (`npm start`), on Node.js 26.13.1, configured by `QUERY_ENGINE_DATABASE_URL`,
  `QUERY_ENGINE_STATEMENT_TIMEOUT_MS` (default 10000), `QUERY_ENGINE_HOST` and `QUERY_ENGINE_PORT`.
- `GET /health`: 200 `{"status":"ok"}` when the database answers, 503 `{"status":"unavailable"}` when not.
- A start-up check that refuses to start, with a plain message, when colouring-core's buildings or footprint
  tables or columns are missing, footprints are not in EPSG:3857, the engine's migrations are not current, or
  the login is a superuser, holds CREATEDB, CREATEROLE, REPLICATION or BYPASSRLS, or can read, change,
  create or use more than the engine role allows (column grants included). Connecting gives up after 5 s.
- Engine migration 001: the `query_engine` schema and the no-login group role `query_engine_reader`, which can
  SELECT `public.buildings`, `public.geometries` and the engine's own tables only.
- `npm run migrate -- up | down | status`, run with `QUERY_ENGINE_MIGRATION_DATABASE_URL`.
- Every query runs in a read-only transaction with the statement timeout set inside it; each connection also
  opens read-only with the timeout as its session default.
- Request logs with the method, route pattern, status and duration only.
- A container image definition (`Dockerfile`) and a compose example beside an existing colouring-core
  database. No image is published yet.
- `npm test`: a throwaway PostGIS database built from colouring-core's migrations at a pinned commit, with
  synthetic fixtures; CI on PostgreSQL 18 with PostGIS 3.6.
- Documentation: host setup guide, API reference, UI integration guide (skeleton), decision records 0001 to
  0008, glossary, tools inventory, contributing guide.

### Host action

- Run the engine's migrations, create the engine's login and grant it `query_engine_reader`
  ([host setup guide](docs/host-setup.md)).
