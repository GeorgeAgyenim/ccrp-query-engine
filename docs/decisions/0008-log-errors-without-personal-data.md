# ADR-0008: Log errors without what people sent or who they are

- Status: Accepted
- Date: 2026-11-26
- Ported from: Colouring Ghana ADR-0005 (2026-11-19; not public)
- Deciders: the first host's product owner (the rule); Claude (Anthropic) as engineer (its form here)
- Related: ADR-0001 (the engine's login), ADR-0007 (start-up check)

## Context

The rule the engine inherits from its first host: never log a person's location, the data they send, or who
they are. Requests to the engine will carry exactly that kind of data: a question's text, the map's
viewport and drawn shapes. Errors repeat it in ways that are easy to miss:
- a PostgreSQL error's `message`, `detail` and `where` can repeat a value from the query
  (`invalid input syntax for type uuid: "<value>"`);
- a connection error names the login (`password authentication failed for user "<name>"`);
- a web framework's default request log records the client's address, and the URL's query string;
- a body-parser error can carry the raw body.

## Decision

- Errors are logged only through `describeError` (`src/safe-log.ts`). It writes the error's name, its `code`
  when that is a short identifier (a SQLSTATE such as `42501`, or a Node code such as `ECONNREFUSED`), and
  the stack's "at …" lines. The message is included only for the engine's own error classes (`EngineError`
  and its subclasses), whose messages must never contain a sent value.
- A request's log line holds its method, route pattern, status and duration. Fastify's own request logging,
  which records the client address, is off.
- The database URLs are never logged or printed. Start-up and migrate-command failures to connect are
  explained by code, without the database's message.
- One exception, to the operator's terminal and not to a log: the migrate command prints the database's
  message for a failed migration statement, because that statement is the engine's own DDL and the message
  is the quickest way to see why it failed.

## Alternatives considered

| Alternative | What it would have meant | Why not |
|---|---|---|
| A deny-list (strip `query`, `params`, `body`) | Log errors whole, minus known fields | Misses the database's own message, which can repeat a value |
| A logging library with redaction | Configure redaction paths | A dependency for what one small function does; redaction rules are still a deny-list |
| Logging database messages | Easier debugging | Shown above to carry values |

## Consequences

- An operator sees what failed, where, and the database code, not the data. Debugging a value-specific
  failure needs a reproduction, not the log.
- It is an allow-list: a new error field is not logged until someone adds it deliberately.
- Evaluation mode (a later ticket) is the one place that writes request content, to its own local file, and
  only when server configuration enables it.

## Plain-English summary

When something goes wrong, the engine's logs say what failed and where, but never what anyone typed, where
they were, or who they are. Database error messages stay out too, because they can repeat what was sent.
