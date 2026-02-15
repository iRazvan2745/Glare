FROM docker.io/oven/bun:1.3.4 AS builder

WORKDIR /app

COPY package.json bun.lock turbo.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter=server

FROM docker.io/oven/bun:1.3.4 AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json

EXPOSE 3000

CMD ["bun", "run", "apps/server/dist/index.mjs"]
