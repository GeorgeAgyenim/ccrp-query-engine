# API reference

The engine's HTTP API. A host's UI reaches it through the host's reverse-proxy route `/api/query/*`, which
forwards to the engine with that prefix removed ([host setup](host-setup.md#reverse-proxy)), so
`GET /api/query/health` on the host is `GET /health` on the engine. Paths below are the engine's own.

Status: pre-release. Only the health endpoint exists.

## Conventions

- Requests and responses are JSON (`application/json`, UTF-8).
- The query API will be versioned in its path (`/v1/...`) and described by the plan JSON Schema published with
  each release. Operational endpoints such as `/health` are not versioned.
- Errors have the body `{"error": "<plain-English message>"}`. A 500 says only `internal error`; the details
  go to the engine's log, without any value a request sent.
- The engine keeps no session and no state between requests.
- A request's log line records its method, route pattern, status and duration, never the query string, body,
  headers or client address.

## `GET /health`

Whether the service is running and can query its database. For container health checks, monitoring and the
host's proxy.

| Status | Body | Meaning |
|---|---|---|
| 200 | `{"status":"ok"}` | The service answered and its database ran a query |
| 503 | `{"status":"unavailable"}` | The service is running but its database did not answer |

```sh
curl -i http://127.0.0.1:3100/health
# HTTP/1.1 200 OK
# content-type: application/json; charset=utf-8
#
# {"status":"ok"}
```

A 503 is logged with the error's name and database error code. The service keeps running and answers 200 again
when the database is back.

## Planned

Each arrives with its own ticket and is documented here when it does:

- read the field catalogue and the reference-layer list;
- *validate*: a plan → valid, or plain-English errors (for the builder);
- read the plan JSON Schema of the running version;
- *run*: a plan and the map state → an answer, a validation failure, or a clarification;
- *ask*: a question, the map state and earlier turns → a plan, a clarification or a decline;
- *download*: a resolved plan → a zip of the full result as CSV and a metadata JSON file.
