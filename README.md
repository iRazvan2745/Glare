# Glare

![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/iRazvan2745/Glare?utm_source=oss&utm_medium=github&utm_campaign=iRazvan2745%2FGlare&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)

Glare is a distributed backup control plane for multi-server environments.
It provides a web UI with embedded API routes, a background jobs service, and worker agents that execute backups locally with `rustic`.

Workers are independent and do not require the control plane to be online. The workers are not the ones scheduling the snapshots, instead they fetch the backup plans periodically and report batched statistics.

## Why Glare?

- Distributed-first design
- Workers operate independently of the control plane
- Simple internal deployment

## Architecture

- `web`: Control plane UI + API routes (auth, worker sync, repositories, plans, runs/events, observability).
- `jobs`: background jobs process (migrations, startup checks, snapshot sync interval).
- `worker`: Rust worker that executes backup jobs. (Requires a port)

## Install guide

### Server and Web app

1. Copy the `podman-compose.yml` file.
2. Update the required environment variables:

- `BETTER_AUTH_SECRET`
  Generate one using:
  [https://www.better-auth.com/docs/installation#set-environment-variables](https://www.better-auth.com/docs/installation#set-environment-variables)

- `NEXT_APP_URL`
  Set this to the URL of the web app/API origin. Used by the Next.js runtime and client-side code.
  Example: `https://app.example.com`

- `APP_URL`
  Set this to the URL of the web app/API origin. Used by server-side code and auth components (Better Auth).
  This can be the same as `NEXT_APP_URL` for single-domain setups.
  Example: `https://app.example.com`

3. Start the stack:

```bash
podman compose up -d
```

To stop it:

```bash
podman compose down
```

4. Reverse proxy:
   Copy the contents of [Caddyfile](https://github.com/iRazvan2745/Glare/blob/main/Caddyfile) in `/etc/caddy/Caddyfile` then run `systemctl restart caddy`

> Podman and caddy are not a required but they are really cool

### Worker

The installer command will show up when you create one.

## API Documentation

You can access it at `http(s)://<your-web-url>/openapi` where `<your-web-url>` is the value you set for `NEXT_APP_URL` or `APP_URL`

## Advisory

- This app is 60% LLM written. Using opus and codex.
- This is an internal app, run it on an internal network. E.g. [Tailscale](https://tailscale.com/)
