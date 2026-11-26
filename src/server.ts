// The engine's HTTP API. Routes are listed in docs/api-reference.md and decided in
// docs/decisions/0011-http-api-v1-routes-and-answer.md; keep the three in step.
//
// A request's log line holds its method, route pattern, status and duration (beside pino's
// level, time, process id, server host name and request counter): never the query string,
// body, headers or client address, which can carry a person's location or identity. Plans
// and validation messages are never logged.

import Fastify, { LogController, type FastifyInstance, type FastifyReply } from 'fastify';
import type { FieldCatalogue } from './catalogue.ts';
import { DatabaseConnectionError, QueryTimeoutError, type Executor } from './executor.ts';
import { runPlan } from './run.ts';
import { describeError, errorCode } from './safe-log.ts';
import { PLAN_SCHEMA } from './schemas.ts';
import { validatePlan } from './validator.ts';

export interface ServerOptions {
  executor: Executor;
  catalogue: FieldCatalogue;
  statementTimeoutMs: number;
}

const PLAN_REQUEST = 'The request body must be a JSON object with one member, "plan".';
// PostgreSQL's numeric_value_out_of_range.
const NUMERIC_VALUE_OUT_OF_RANGE = '22003';

export function buildServer(options: ServerOptions): FastifyInstance {
  // JSON log lines on stdout. Fastify's own request logging is off: it records the client address.
  const app = Fastify({ logger: true, logController: new LogController({ disableRequestLogging: true }) });

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

  app.setNotFoundHandler(async (_request, reply) =>
    reply.status(404).send({ error: 'There is no such route. The routes are listed in docs/api-reference.md.' }),
  );

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

  app.get('/v1/catalogue', async () => options.catalogue.grouped());

  app.get('/v1/plan-schema', async () => PLAN_SCHEMA);

  app.post('/v1/validate', async (request, reply) => {
    const plan = planOf(request.body, reply);
    if (plan === undefined) return reply;
    const validation = validatePlan(plan.value, options.catalogue);
    return validation.valid ? { status: 'valid' } : { status: 'invalid', errors: validation.errors };
  });

  app.post('/v1/run', async (request, reply) => {
    const plan = planOf(request.body, reply);
    if (plan === undefined) return reply;
    const validation = validatePlan(plan.value, options.catalogue);
    if (!validation.valid) return reply.status(422).send({ status: 'invalid', errors: validation.errors });
    try {
      return await runPlan(validation.plan, options.catalogue, options.executor);
    } catch (error) {
      if (error instanceof QueryTimeoutError) {
        request.log.warn({ error: describeError(error) }, 'run stopped by the statement timeout');
        return reply.status(503).send({
          error:
            `The question took longer than the engine's limit of ${options.statementTimeoutMs} ms and was stopped. ` +
            'Try a smaller area or fewer conditions.',
        });
      }
      // Numbers are compared in their column's own type (src/compiler.ts), so a value the plan
      // format allows can still be beyond the column's range (a real holds up to about 3.4e38).
      if (errorCode(error) === NUMERIC_VALUE_OUT_OF_RANGE) {
        return reply.status(422).send({
          status: 'invalid',
          errors: [
            {
              message: 'A number in the plan is too large or too small for the field it is compared with.',
              step: null,
              field: null,
              path: '',
            },
          ],
        });
      }
      if (isUnavailable(error)) {
        request.log.warn({ error: describeError(error) }, 'run could not reach the database');
        return reply.status(503).send({ error: "The engine's database is not answering. Try again later." });
      }
      throw error;
    }
  });

  return app;
}

/** The request's plan, or undefined after answering 400. */
function planOf(body: unknown, reply: FastifyReply): { value: unknown } | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body) || !('plan' in body)) {
    void reply.status(400).send({ error: PLAN_REQUEST });
    return undefined;
  }
  if (Object.keys(body).length !== 1) {
    void reply.status(400).send({ error: `${PLAN_REQUEST} API version 1 has no other request members.` });
    return undefined;
  }
  return { value: (body as { plan: unknown }).plan };
}

// Connection failures, and the server closing the connection (SQLSTATE classes 08 and 57P).
function isUnavailable(error: unknown): boolean {
  if (error instanceof DatabaseConnectionError) return true;
  const code = errorCode(error);
  return code !== undefined && (code.startsWith('08') || code.startsWith('57P') || code === 'ECONNRESET');
}
