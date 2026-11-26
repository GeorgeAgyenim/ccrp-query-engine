# The query engine service. Node runs the TypeScript sources directly, so there is no build
# step: the image holds the production dependencies, src/ and migrations/.
#
#   docker build -t ccrp-query-engine .
#   docker run --rm -p 127.0.0.1:3100:3100 -e QUERY_ENGINE_DATABASE_URL=... ccrp-query-engine
#
# Settings: docs/host-setup.md. Keep the Node version in step with .nvmrc.

FROM node:26.13.1-trixie-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:26.13.1-trixie-slim
ENV NODE_ENV=production \
    QUERY_ENGINE_HOST=0.0.0.0 \
    QUERY_ENGINE_PORT=3100
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY migrations ./migrations
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.QUERY_ENGINE_PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/main.ts"]
