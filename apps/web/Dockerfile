FROM docker.io/oven/bun:1.3.4

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3002
ENV HOSTNAME=0.0.0.0

COPY package.json bun.lock turbo.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile

ARG NEXT_PUBLIC_SERVER_URL=""
ENV NEXT_PUBLIC_SERVER_URL=$NEXT_PUBLIC_SERVER_URL

RUN bunx turbo run build --filter=web

WORKDIR /app/apps/web
USER bun
EXPOSE 3002

CMD ["bun", "run", "start"]
