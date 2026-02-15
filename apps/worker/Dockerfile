FROM rust:1.85-alpine AS builder

WORKDIR /app

COPY apps/worker/Cargo.toml apps/worker/Cargo.lock ./apps/worker/
COPY apps/worker/src ./apps/worker/src

RUN cargo build --manifest-path apps/worker/Cargo.toml --release

FROM alpine:3.21 AS runner

WORKDIR /app

RUN apk add --no-cache ca-certificates \
  && addgroup -S worker \
  && adduser -S worker -G worker \
  && mkdir -p /var/lib/glare-worker \
  && chown -R worker:worker /var/lib/glare-worker /app

COPY --from=builder /app/apps/worker/target/release/worker /app/worker

ENV LOCAL_API_ENDPOINT="http://0.0.0.0:3001"
ENV RUSTIC_BIN="rustic"
ENV STATE_DIR="/var/lib/glare-worker"

USER worker
EXPOSE 3001

ENTRYPOINT ["/app/worker"]
