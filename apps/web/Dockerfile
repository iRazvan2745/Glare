FROM docker.io/oven/bun:1.3.4 AS builder

WORKDIR /app

COPY package.json bun.lock turbo.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile

ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_SERVER_URL=""
ENV NEXT_PUBLIC_SERVER_URL=$NEXT_PUBLIC_SERVER_URL

RUN bunx turbo run build --filter=web

FROM docker.io/oven/bun:1.3.4 AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3002
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

USER bun
EXPOSE 3002

CMD ["bun", "apps/web/server.js"]
