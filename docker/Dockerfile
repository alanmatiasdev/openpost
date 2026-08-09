# Build stage for frontend
FROM oven/bun:1.3.11-alpine AS frontend-builder

WORKDIR /app

# Copy workspace manifests first for dependency caching.
COPY package.json bun.lock bunfig.toml turbo.json ./
COPY frontend/package.json ./frontend/
COPY docs-site/package.json ./docs-site/
COPY marketing-site/package.json ./marketing-site/
COPY packages/changelog/package.json ./packages/changelog/
COPY packages/legal-policy/package.json ./packages/legal-policy/
COPY packages/social-images/package.json ./packages/social-images/
COPY packages/social-preview/package.json ./packages/social-preview/
COPY packages/video-project/package.json ./packages/video-project/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --filter @openpost/web

COPY frontend/ ./frontend/
COPY packages/social-preview/ ./packages/social-preview/
COPY packages/video-project/ ./packages/video-project/
COPY assets/ ./assets/
COPY scripts/sync-assets.mjs scripts/generate-app-route-manifest.mjs scripts/precompress-static.mjs ./scripts/
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN bun run --filter @openpost/web build

# Build stage for backend
FROM golang:1.26.5-alpine AS backend-builder

ARG VERSION=dev
ARG COMMIT=unknown
ARG RELEASE_MANIFEST_B64=""
ARG RELEASE_MANIFEST_SHA256=""

RUN apk add --no-cache gcc jq musl-dev sqlite-dev

WORKDIR /app

COPY backend/go.mod backend/go.sum ./backend/
RUN --mount=type=cache,target=/go/pkg/mod \
    cd backend && go mod download

COPY backend/ ./backend/
COPY provider-certification/public-claims.json ./provider-certification/public-claims.json
# Package the frontend-owned build output at the backend embed boundary.
COPY --from=frontend-builder /app/frontend/build ./backend/cmd/openpost/public

RUN provider_claims_sha256="$(sha256sum provider-certification/public-claims.json | cut -d ' ' -f1)" && \
    provider_claim_count="$(jq -er '.claims | length' provider-certification/public-claims.json)" && \
    if [ -n "${RELEASE_MANIFEST_B64}" ]; then \
      printf '%s' "${RELEASE_MANIFEST_B64}" | base64 -d > release-manifest.json; \
      printf '%s  %s\n' "${RELEASE_MANIFEST_SHA256}" release-manifest.json | sha256sum -c -; \
    else \
      jq -n \
        --arg version "${VERSION}" \
        --arg revision "${COMMIT}" \
        --arg provider_claims_sha256 "sha256:${provider_claims_sha256}" \
        --argjson provider_claim_count "${provider_claim_count}" \
        '{schema_version: 2, version: $version, revision: $revision, provider_claims: {schema_version: 1, manifest_sha256: $provider_claims_sha256, claim_count: $provider_claim_count}}' > release-manifest.json; \
    fi && \
    test "$(jq -er '.schema_version' release-manifest.json)" = 2 && \
    test "$(jq -er '.version' release-manifest.json)" = "${VERSION}" && \
    test "$(jq -er '.revision' release-manifest.json)" = "${COMMIT}" && \
    test "$(jq -er '.provider_claims.schema_version' release-manifest.json)" = 1 && \
    test "$(jq -er '.provider_claims.manifest_sha256' release-manifest.json)" = "sha256:${provider_claims_sha256}" && \
    test "$(jq -er '.provider_claims.claim_count' release-manifest.json)" = "${provider_claim_count}"

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    cd backend && CGO_ENABLED=1 GOOS=linux go build -buildvcs=false -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" -o openpost ./cmd/openpost

# Runtime stage
FROM alpine:3.19

ARG VERSION=dev
ARG COMMIT=unknown
ARG RELEASE_MANIFEST_SHA256=""
LABEL org.opencontainers.image.title="OpenPost" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT}" \
      org.opencontainers.image.source="https://github.com/rodrgds/openpost" \
      io.openpost.release-manifest.sha256="${RELEASE_MANIFEST_SHA256}"

RUN apk add --no-cache ca-certificates ffmpeg tzdata sqlite

RUN adduser -D -u 1000 openpost

WORKDIR /app

COPY --from=backend-builder /app/backend/openpost .
COPY --from=backend-builder /app/release-manifest.json ./release-manifest.json

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
