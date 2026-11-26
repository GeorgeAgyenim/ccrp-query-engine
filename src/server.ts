// The engine's HTTP API. Routes are listed in docs/api-reference.md; keep the two in step.
//
// Request logs name the route pattern, status and duration only: never the query string,
// body, headers or client address, which can carry a person's location or identity.

import Fastify, { type FastifyInstance } from 'fastify';
import type { Executor } from './executor.ts';
import { describeError } from './safe-log.ts';

export interface ServerOptions {
  executor: Executor;
}

export function buildServer(options: ServerOptions): FastifyInstance {
  // JSON log lines on stdout. Fastify's own request logging is off: it records the client address.
  const app = Fastify({ logger: true, disableRequestLogging: true });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        route: request.routeOptions.url ?? 'unmatched',
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      'request',
    );
  });

  // Fastify's own 4xx errors (a malformed body, say) keep their message, which names no sent
  // value. Anything else is a 500 with a generic body, logged without its message.
  app.setErrorHandler(async (error: unknown, request, reply) => {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({ error: error instanceof Error ? error.message : 'bad request' });
    }
    request.log.error({ error: describeError(error) }, 'request failed');
    return reply.status(500).send({ error: 'internal error' });
  });

  // Liveness and database reachability, for container health checks and the host's proxy.
  app.get('/health', async (request, reply) => {
    try {
      await options.executor.read((query) => query('SELECT 1'));
      return { status: 'ok' };
    } catch (error) {
      request.log.warn({ error: describeError(error) }, 'health check could not reach the database');
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  return app;
}
