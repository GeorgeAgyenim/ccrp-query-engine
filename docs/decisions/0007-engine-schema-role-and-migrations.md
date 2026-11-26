# ADR-0007: The engine's schema, group role and migrations, and a start-up check that fails closed

- Status: Proposed, awaiting the product owner's acceptance (one-way door: the schema, role and setting
  names are what hosts' databases, grants and deployments refer to). Implemented in query-engine ticket 01;
  nothing is released, so the names can still change at no cost to any host.
- Date: 2026-11-26
- Origin: new in the engine repository (query-engine ticket 01); implements ADR-0001 and ADR-0006
- Deciders: proposed by Claude (Anthropic) as engineer, within the product owner's accepted ADR-0001 and
  ADR-0006
- Related: ADR-0001, ADR-0004, ADR-0006, ADR-0008

## Context

The engine owns its own tables and never changes the host's (ADR-0006), and it reads through a role that can
see only buildings, footprints and its own tables (ADR-0001). Several facts shape how:

- PostgreSQL roles belong to the whole server (the *cluster*), not to one database, while grants belong to
  one database. A host may run the engine against more than one database on one server, such as the live
  database and a frozen copy.
- Creating a role and granting on the host's tables needs owner rights. The running service must never hold
  them.
- Settings such as `statement_timeout` placed on a group role are not inherited by the logins that are
  members of it, so the role cannot carry the timeout.
- `ALTER DEFAULT PRIVILEGES` applies only to objects created later by the login that ran it, so it would
  silently miss a table created by a different administrator.
- colouring-core applies its own migrations as numbered `NNN.name.up.sql` / `.down.sql` files, which host
  operators already know.
- An engine that starts with the wrong login (the app's owner login, say) would quietly undo ADR-0001.

## Decision

- **Schema.** `query_engine`, created by engine migration 001. Every engine table lives there.
- **Group role.** `query_engine_reader`, `NOLOGIN` with no attributes. In each database it gets `USAGE` on
  schema `public` and `SELECT` on `public.buildings` and `public.geometries`, and `USAGE` on
  `query_engine` and `SELECT` on each engine table. Each migration that creates a table grants `SELECT`
  on it explicitly; a test fails if any engine table is not readable by the role. Operators create the
  engine's login and grant it the role (`docs/host-setup.md`).
- **Migrations.** Numbered SQL files in `migrations/`, `NNN.lower-case-words.up.sql` with a matching
  `.down.sql`, as in colouring-core. The engine's `migrate up | down | status` command applies them with a
  separate owner login (`QUERY_ENGINE_MIGRATION_DATABASE_URL`), each migration and its record row in one
  transaction, under a PostgreSQL advisory lock so two runs cannot interleave. Applied ids are recorded in
  `query_engine.migrations`, which migration 001 creates.
- **The cluster-wide role.** Migration 001 creates the role only if it does not exist, and stops if a role of
  that name exists with a login or any attribute. Its down migration drops the role only when no other
  database still grants it anything; otherwise it keeps it and says so.
- **Start-up check, failing closed.** Before serving, the service refuses to start, printing each problem as a
  plain sentence, when:
  - its login is a superuser, or has CREATEDB, CREATEROLE, REPLICATION or BYPASSRLS;
  - it can read any relation, or any column of one, other than the host's buildings and geometries and the
    engine's tables (objects owned by an extension, such as PostGIS's `spatial_ref_sys`, are allowed: every
    login can read them);
  - it can change any relation or any column of one, use any sequence, or create objects in any schema;
  - colouring-core's tables or columns are missing, or footprints are not in EPSG:3857;
  - the engine's migrations are not current, or it cannot read their record.
- **Statement timeout.** Set in every transaction by the executor (ADR-0001), default 10 s, five times the
  2 s answer target, so a slow but legitimate plan still answers while a runaway one is cancelled. Each
  connection also opens with read-only transactions and the same timeout as session defaults, so a
  statement that ended the transaction early still cannot write or run unbounded. Connecting gives up
  after 5 s.
- **Setting names.** `QUERY_ENGINE_*` environment variables (`docs/host-setup.md#settings`); the migrate
  command alone reads `QUERY_ENGINE_MIGRATION_DATABASE_URL`.

## Alternatives considered

| Alternative | What it would have meant | Why not |
|---|---|---|
| node-pg-migrate | A migration library with its own tracking table | A dependency for what a short module does; its JavaScript migrations are less readable to database administrators than colouring-core-style SQL files |
| colouring-core's psql loop, no record | Operators run every `.up.sql` by hand | Nothing records what is applied, so upgrades re-run migrations and the service cannot tell whether the database is current |
| A tracking table in `public` | Record migrations outside the engine schema | Adds a table to the host's own schema |
| `ALTER DEFAULT PRIVILEGES` for engine tables | Future tables readable automatically | Applies only to tables created by the login that ran it; hidden state that a different administrator bypasses |
| Timeout and read-only settings on the group role | `ALTER ROLE query_engine_reader SET ...` | Members do not inherit a group role's settings, so it would do nothing |
| Column-level grants on buildings | Grant only the columns the catalogue uses | A grant migration per new field; the catalogue already decides which columns the engine reads |
| A start-up check that only warns | Log broader access and serve anyway | A warning in a log is easy to miss; the restricted login is the guarantee contributors rely on |

## Consequences

- Host databases gain one schema, `query_engine`, and the server gains one role, `query_engine_reader`.
  Renaming either later means a migration in every host database and new grants by every operator.
- A server with several engine databases shares one role, each database granting it separately.
- Reverting migration 001 on a server's only engine database drops the role, which also removes it from the
  engine's login; after migrating up again, the operator grants it again.
- A host that grants reads on other tables to `PUBLIC` cannot start the engine until it revokes them or gives
  the engine a database where they do not apply. The refusal names each table.
- The test command leaves the role on the test server; once the test databases are dropped it holds no
  privileges.

## Plain-English summary

The engine keeps its own tables in its own corner of the database and reads through a named group login
that can only see buildings, footprints and those tables. Changes to that corner are applied by a small,
recorded, one-at-a-time process using an administrator login the running service never sees. If the service
is started with a login that can see or change anything more, it refuses to run and says why.
