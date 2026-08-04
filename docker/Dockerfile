# Build stage for frontend
FROM oven/bun:1.3.11-alpine AS frontend-builder

WORKDIR /app

# Copy workspace manifests first for dependency caching.
COPY package.json bun.lock bunfig.toml turbo.json ./
COPY frontend/package.json ./frontend/
COPY docs-site/package.json ./docs-site/
COPY marketing-site/package.json ./marketing-site/
COPY packages/changelog/package.json ./packages/changelog/
COPY packages/social-images/package.json ./packages/social-images/
COPY packages/social-preview/package.json ./packages/social-preview/
COPY packages/video-project/package.json ./packages/video-project/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --filter @openpost/web

COPY frontend/ ./frontend/
COPY packages/social-preview/ ./packages/social-preview/
COPY packages/social-images/ ./packages/social-images/
COPY packages/video-project/ ./packages/video-project/
COPY assets/ ./assets/
COPY docs-site/ ./docs-site/
COPY scripts/sync-assets.mjs scripts/precompress-static.mjs ./scripts/
COPY scripts/social-images/catalog.mjs ./scripts/social-images/
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN mkdir -p backend/cmd/openpost/public && bun run --filter @openpost/web build

# Build stage for backend
FROM golang:1.26.5-alpine AS backend-builder

ARG VERSION=dev
ARG COMMIT=unknown

RUN apk add --no-cache gcc musl-dev sqlite-dev

WORKDIR /app

COPY backend/go.mod backend/go.sum ./backend/
RUN --mount=type=cache,target=/go/pkg/mod \
    cd backend && go mod download

COPY backend/ ./backend/
# Copy frontend build output from the correct location
COPY --from=frontend-builder /app/backend/cmd/openpost/public ./backend/cmd/openpost/public

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    cd backend && CGO_ENABLED=1 GOOS=linux go build -buildvcs=false -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" -o openpost ./cmd/openpost

# Runtime stage
FROM alpine:3.19

ARG VERSION=dev
ARG COMMIT=unknown
LABEL org.opencontainers.image.title="OpenPost" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT}" \
      org.opencontainers.image.source="https://github.com/rodrgds/openpost"

RUN apk add --no-cache ca-certificates ffmpeg tzdata sqlite

RUN adduser -D -u 1000 openpost

WORKDIR /app

COPY --from=backend-builder /app/backend/openpost .

RUN mkdir -p /data/media /data/db && chown -R openpost:openpost /data

USER openpost

ENV OPENPOST_PORT=8080
ENV OPENPOST_EDITION=selfhost
ENV OPENPOST_DATABASE_DRIVER=sqlite
ENV OPENPOST_DATABASE_PATH=/data/db/openpost.db
ENV OPENPOST_STORAGE_DRIVER=local
ENV OPENPOST_MEDIA_PATH=/data/media

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/v1/ready || exit 1

CMD ["./openpost"]
