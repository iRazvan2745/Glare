FROM docker.io/oven/bun:1.3.4 AS builder

WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock turbo.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile

EXPOSE 3000

CMD ["sh", "-lc", "bun run db:init && bun run apps/server/index.ts"]
