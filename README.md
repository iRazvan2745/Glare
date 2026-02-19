# Glare

Glare is a distributed backup control plane for multi-server environments.  
It provides a web UI, an API server, and worker agents that execute backups locally with `rustic`.

## Codebase Analysis

This repository is a Bun + Turborepo monorepo.

### Apps

- `apps/server`: Elysia API server (auth, worker sync, repositories, plans, runs/events, observability).
- `apps/web`: Next.js control plane UI.
- `apps/docs`: Next.js docs site (Fumadocs).
- `apps/worker`: Rust worker service (Axum) that executes backup jobs and reports status.

### Shared Packages

- `packages/db`: Drizzle ORM schema, SQL migrations, DB scripts.
- `packages/auth`: Better Auth integration.
- `packages/env`: typed environment access for server/web.
- `packages/config`: shared TypeScript config.

### Runtime Topology

1. `apps/web` talks to `apps/server`.
2. `apps/server` persists state to PostgreSQL.
3. `apps/worker` syncs plans from `apps/server`, runs backups locally, and reports execution results.

## Prerequisites

- Bun `1.3.4+`
- Docker or Podman (for local PostgreSQL via compose)
- Rust toolchain (if building/running worker locally)

## Environment

Create `apps/server/.env`:

```bash
DATABASE_URL=postgresql://postgres:password@localhost:5434/glare
BETTER_AUTH_SECRET=change-me
CORS_ORIGIN=http://localhost:3002
BETTER_AUTH_URL=http://localhost:3000
# Optional overrides:
# BETTER_AUTH_BASE_URL=http://localhost:3000
# WEB_ORIGIN=http://localhost:3002
# NEXT_PUBLIC_APP_URL=http://localhost:3002
```

Create `apps/web/.env.local`:

```bash
NEXT_PUBLIC_SERVER_URL=http://localhost:3000
```

## Quick Start

```bash
bun install
bun run db:start
bun run dev
```

Default local ports:

- API server: `3000`
- Web app: `3002`
- Postgres (compose): `5434`

## Database Migrations

Server startup now applies pending Drizzle migrations automatically before serving traffic.

- Local dev (`apps/server/src/index.ts`): migrations run on every process start.
- Docker server image: migration SQL files are copied into the runtime image and applied on boot.

Manual migration command is still available:

```bash
bun run db:migrate
```

## Useful Commands

```bash
# all dev tasks through turbo
bun run dev

# server only
bun run dev:server

# web only
bun run dev:web

# db utilities
bun run db:start
bun run db:stop
bun run db:down
bun run db:studio
```

## Build

```bash
bun run build
```
