FROM docker.io/oven/bun:1.3.4 AS builder

WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock turbo.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter=server

WORKDIR /app

EXPOSE 3000

CMD ["bun", "run", "apps/server/dist/index.mjs"]
