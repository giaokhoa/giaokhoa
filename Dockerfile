
# syntax=docker/dockerfile:1

FROM node:24-bookworm AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm exec turbo run build --filter=@giaokhoa/api --filter=@giaokhoa/worker --filter=@giaokhoa/web
RUN pnpm --filter @giaokhoa/api deploy --prod /out/api \
  && pnpm --filter @giaokhoa/worker deploy --prod /out/worker \
  && pnpm --filter @giaokhoa/web deploy --prod /out/web

FROM node:24-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-18 \
  && rm -rf /var/lib/apt/lists/*
USER node
EXPOSE 3100
CMD ["node", "dist/main.js"]

FROM node:24-bookworm-slim AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/worker ./
USER node
CMD ["node", "dist/main.js"]

FROM node:24-bookworm-slim AS web
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/web ./
USER node
EXPOSE 3000
CMD ["./node_modules/.bin/react-router-serve", "build/server/index.js"]
