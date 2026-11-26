# CCRP Query Engine

A read-only query service for [Colouring Cities](https://github.com/colouring-cities) platforms. It selects
and counts buildings in a map area by their attributes. It runs beside a colouring-core platform and reads that
platform's PostGIS database; the platform forwards `/api/query/*` to it.

**Status:** early development. The service starts and checks its database access; query endpoints are not
available yet. See the [changelog](CHANGELOG.md).

## Requirements

- A colouring-core platform and its PostgreSQL/PostGIS database
- Node.js 26 (see `.nvmrc`), or Docker with Compose
- `psql`, and an administrator login on the database for setup

## Set up with your platform

1. **Install**

   ```sh
   git clone https://github.com/GeorgeAgyenim/ccrp-query-engine.git
   cd ccrp-query-engine
   npm ci
   ```

2. **Add the engine's schema and read-only role** to your database:

   ```sh
   QUERY_ENGINE_MIGRATION_DATABASE_URL='postgres://<admin>:<password>@<host>:5432/<database>' npm run migrate -- up
   ```

3. **Create a login for the engine** (in `psql`, as an administrator):

   ```sql
   CREATE ROLE query_engine_login LOGIN;
   \password query_engine_login
   GRANT query_engine_reader TO query_engine_login;
   ALTER ROLE query_engine_login SET default_transaction_read_only = on;
   ```

   Then allow it to connect in `pg_hba.conf`.

4. **Start the engine** and check it:

   ```sh
   QUERY_ENGINE_DATABASE_URL='postgres://query_engine_login:<password>@<host>:5432/<database>' npm start
   curl http://127.0.0.1:3100/health    # {"status":"ok"}
   ```

5. **Forward `/api/query/` from your platform** to the engine, for example with nginx:

   ```nginx
   location /api/query/ {
       proxy_pass http://127.0.0.1:3100/;
   }
   ```

6. **Add the screens** to your frontend by following the [UI integration guide](docs/ui-integration-guide.md).

To run it in Docker instead, use [`compose.example.yaml`](compose.example.yaml). The
[host setup guide](docs/host-setup.md) covers every setting, `pg_hba.conf`, upgrades and start-up errors.

## Development

```sh
npm run typecheck
npm test
```

The tests need a disposable PostGIS server; the [testing guide](docs/testing.md) shows how to start one.
Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

- [Host setup guide](docs/host-setup.md)
- [UI integration guide](docs/ui-integration-guide.md)
- [API reference](docs/api-reference.md)
- [Testing guide](docs/testing.md)
- [Decision records](docs/decisions/README.md)
- [Glossary](CONTEXT.md)

## Licence

[GPL-3.0](LICENSE), the same licence as colouring-core.
