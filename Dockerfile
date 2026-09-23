# syntax=docker/dockerfile:1

# ---- Build ----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies first so the layer is cached until the lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json vite.config.ts vitest.config.ts index.html ./
COPY public ./public
COPY src ./src
COPY server ./server
COPY tests ./tests
COPY scripts ./scripts

# Type errors and failing tests must not reach an image.
RUN npm run test
RUN npm run build

# ---- Runtime --------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

# node:sqlite is experimental in Node 22 and prints a warning on every start;
# it is expected and not a problem.
ENV NODE_ENV=production \
    PORT=8080 \
    RALLY_DATA_DIR=/data \
    RALLY_STATIC_DIR=/app/dist

# The `node` user and group already exist in the base image. /data is the
# SQLite volume; it needs to be writable by the user the process runs as.
RUN mkdir -p /data && chown -R node:node /data /app

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server

USER node
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/api/health || exit 1

STOPSIGNAL SIGTERM
CMD ["node", "--disable-warning=ExperimentalWarning", "dist-server/server.mjs"]
