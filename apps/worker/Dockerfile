FROM docker.io/library/rust:1.93-alpine AS builder

WORKDIR /app

RUN apk add --no-cache build-base musl-dev

COPY apps/worker/Cargo.toml apps/worker/Cargo.lock ./apps/worker/
COPY apps/worker/src ./apps/worker/src

RUN cargo build --manifest-path apps/worker/Cargo.toml --release

FROM docker.io/library/rust:1.93-alpine AS rustic-builder

RUN apk add --no-cache build-base musl-dev
RUN cargo install --locked --root /opt/rustic rustic-rs

FROM docker.io/library/alpine:3.21 AS runner

WORKDIR /app

RUN apk add --no-cache ca-certificates rclone \
  && addgroup -S worker \
  && adduser -S worker -G worker \
  && mkdir -p /var/lib/glare-worker \
  && chown -R worker:worker /var/lib/glare-worker /app

COPY --from=builder /app/apps/worker/target/release/worker /app/worker
COPY --from=rustic-builder /opt/rustic/bin/rustic /usr/local/bin/rustic

ENV RUSTIC_BIN="/usr/local/bin/rustic"
ENV STATE_DIR="/var/lib/glare-worker"

USER worker
EXPOSE 3001

ENTRYPOINT ["/app/worker"]
