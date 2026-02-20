# Glare

Glare is a distributed backup control plane for multi-server environments.
It provides a web UI, an API server, and worker agents that execute backups locally with `rustic`.

Workers are independent and do not require the API server to be online. The workers are not the ones scheduling the snapshots, instead they fetch the backup plans periodically and reports batched statistics.

## Why Glare?

- Distributed-first design
- Workers operate independently of the control plane
- Simple internal deployment

## Architecture

- `server`: API server (auth, worker sync, repositories, plans, runs/events, observability).
- `web`: Control plane UI.
- `worker`: Rust worker that executes backup jobs. (Requires a port)

## Install guide

### Server and Web app

1. Copy the `podman-compose.yml` file.
2. Update the required environment variables:

* `BETTER_AUTH_SECRET`
  Generate one using:
  [https://www.better-auth.com/docs/installation#set-environment-variables](https://www.better-auth.com/docs/installation#set-environment-variables)

* `CORS_ORIGIN`
  Set this to the URL of the web app.

* `BETTER_AUTH_URL`
  Set this to the URL of the API server.

3. Start the stack:

```bash
podman compose up -d
```

To stop it:

```bash
podman compose down
```

4. Reverse proxy:
   Copy the contents of [Caddyfile](https://github.com/iRazvan2745/Glare/blob/main/Caddyfile) in ```/etc/caddy/Caddyfile``` then run ```systemctl restart caddy```

> Podman and caddy are not a required but they are really cool

### Worker

The installer command will show up when you create one.

## API Documentation

You can access it at ```http(s)://<API URL>/openapi```

## Advisory

- This app is 60% LLM written. Using opus and codex.
- This is an internal app, run it on an internal network. E.g. [Tailscale](https://tailscale.com/)
