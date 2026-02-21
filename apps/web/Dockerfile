FROM docker.io/oven/bun:1.3.4

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY package.json bun.lock turbo.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile

ARG NEXT_APP_URL="http://localhost:3002"
ENV NEXT_APP_URL=$NEXT_APP_URL
ARG APP_URL="http://localhost:3002"
ENV APP_URL=$APP_URL

ARG DATABASE_URL="postgresql://postgres:postgres@localhost:5432/glare"
RUN DATABASE_URL="$DATABASE_URL" bunx turbo run build --filter=web

WORKDIR /app/apps/web
USER bun
EXPOSE 3000

CMD ["bun", "run", "start"]
