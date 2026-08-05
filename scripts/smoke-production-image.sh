#!/usr/bin/env bash
set -euo pipefail

image="${1:?usage: smoke-production-image.sh IMAGE [EXPECTED_COMMIT]}"
expected_commit="${2:-}"
container="openpost-smoke-${RANDOM}-$$"
port="${OPENPOST_SMOKE_PORT:-18080}"
database_volume="openpost-smoke-db-${RANDOM}-$$"
smoke_jwt_secret="$(openssl rand -hex 32)"
smoke_encryption_key="$(openssl rand -hex 16)"
smoke_environment=(
  --env "OPENPOST_APP_URL=http://127.0.0.1:${port}"
  --env "OPENPOST_JWT_SECRET=${smoke_jwt_secret}"
  --env "OPENPOST_ENCRYPTION_KEY=${smoke_encryption_key}"
)

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm -f "$database_volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker volume create "$database_volume" >/dev/null

# Exercise the same no-side-effect configuration check used by the production
# deployment gate before starting a database-backed container.
docker run --rm "${smoke_environment[@]}" "$image" ./openpost check-config >/dev/null

docker run --detach --name "$container" \
  --publish "127.0.0.1:${port}:8080" \
  --volume "$database_volume:/data/db" \
  "${smoke_environment[@]}" \
  "$image" >/dev/null

for _ in $(seq 1 60); do
  if curl --fail --silent "http://127.0.0.1:${port}/api/v1/ready" >/dev/null; then
    break
  fi
  sleep 1
done
if ! docker inspect --format '{{.State.Running}}' "$container" | grep -qx true; then
  docker logs "$container" >&2
fi
curl --fail --show-error "http://127.0.0.1:${port}/api/v1/ready"

docker restart "$container" >/dev/null
for _ in $(seq 1 60); do
  if curl --fail --silent "http://127.0.0.1:${port}/api/v1/ready" >/dev/null; then
    break
  fi
  sleep 1
done
curl --fail --show-error "http://127.0.0.1:${port}/api/v1/ready"

if [[ -n "$expected_commit" ]]; then
  actual_commit="$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")"
  [[ "$actual_commit" == "$expected_commit" ]] || {
    printf 'expected image revision %s, got %s\n' "$expected_commit" "$actual_commit" >&2
    exit 1
  }
  running_commit="$(curl --fail --silent "http://127.0.0.1:${port}/api/v1/version" | jq -r .revision)"
  [[ "$running_commit" == "$expected_commit" ]] || {
    printf 'expected running revision %s, got %s\n' "$expected_commit" "$running_commit" >&2
    exit 1
  }
fi
