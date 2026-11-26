# CCRP Query Engine

Ask questions about the buildings on a [Colouring Cities](https://github.com/colouring-cities) map, and get
answers that are honest about missing data.

> **Status: early development, not ready for use yet.** The service runs and protects the database, but it
> does not answer questions yet. See [What works today](#what-works-today).

## What it does

Someone using a Colouring Cities platform picks an area on the map: a district, the current view, a
selected building, or a shape they draw. Then they ask a question about the buildings in it, either by
clicking options or by typing in plain English. For example: *"How many residential buildings in poor
condition are in this area?"*

Crowdsourced building data is incomplete, so a bare count can mislead. Every answer therefore says:

- how many buildings were in the area;
- how many have the asked-about details recorded;
- how many match;
- when the data was read.

The matching buildings are highlighted on the map and can be downloaded.

## How it fits with your platform

The engine is a separate program that runs next to an existing colouring-core platform. Your platform's code
stays as it is, apart from one forwarding route and the screens you add.

```text
Your Analyse screen  →  your platform (/api/query/*)  →  query engine  →  your database (read-only)
```

- It reads your database through its own login, which can see building data and nothing else: no user
  accounts or logs.
- It learns your fields from your platform's own field definitions, so it fits any Colouring Cities
  instance.
- You build the screens in your own frontend. The [UI integration guide](docs/ui-integration-guide.md)
  walks you through them.

## What works today

| Part | State |
|---|---|
| Service, health check and start-up safety check | Done |
| Read-only database login, and a time limit on every query | Done |
| Answering questions (plans, counts, map results) | Next |
| Plain-English assistant | Later |
| Download and share | Later |

The [changelog](CHANGELOG.md) lists each release.

## Try it locally

You need Node.js 26 (`nvm use` reads `.nvmrc`) and a colouring-core PostgreSQL/PostGIS database.

```sh
npm ci
QUERY_ENGINE_MIGRATION_DATABASE_URL='postgres://<owner>:<password>@<host>:5432/<database>' npm run migrate -- up
QUERY_ENGINE_DATABASE_URL='postgres://<engine login>:<password>@<host>:5432/<database>' npm start
curl http://127.0.0.1:3100/health    # {"status":"ok"}
```

The engine refuses to start unless it has its own restricted login. The
[host setup guide](docs/host-setup.md) shows how to create that login, and covers every setting, the
container image and a ready-made compose file.

## Documentation

- [Host setup guide](docs/host-setup.md): run the engine for your platform.
- [UI integration guide](docs/ui-integration-guide.md): build the screens.
- [API reference](docs/api-reference.md): what the engine accepts and returns.
- [Testing guide](docs/testing.md): run the test suite.
- [Decision records](docs/decisions/README.md): why it is built this way.
- [Glossary](CONTEXT.md): the terms used throughout.

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers branches, commits and the safety rules
for this public repository.

## Licence

[GPL-3.0](LICENSE), the same licence as colouring-core.
