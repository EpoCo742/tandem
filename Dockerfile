# Single-container Tandem POC: builds the SPA, runs the Fastify server that serves it.
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile
COPY shared shared
COPY server server
COPY web web
RUN pnpm --filter @tandem/web build

FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data WEB_DIST=/app/web/dist
VOLUME ["/data"]
EXPOSE 3000
CMD ["pnpm", "--filter", "@tandem/server", "start"]
