#!/usr/bin/env bash

set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: release-asset-upload.sh <asset> [<asset> ...]" >&2
  exit 2
fi

: "${GITHUB_REF_NAME:?GITHUB_REF_NAME is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"

retry_delay_seconds="${OPENPOST_RELEASE_ASSET_RETRY_DELAY_SECONDS:-3}"
[[ "$retry_delay_seconds" =~ ^[0-9]+$ ]] || {
  echo "OPENPOST_RELEASE_ASSET_RETRY_DELAY_SECONDS must be a non-negative integer." >&2
  exit 2
}

expected_state=$'true\tfalse\t'"$GITHUB_REF_NAME"
release_state=""

for attempt in $(seq 1 20); do
  if release_state="$(gh release view "$GITHUB_REF_NAME" \
    --repo "$GITHUB_REPOSITORY" \
    --json isDraft,isPrerelease,tagName \
    --jq '[.isDraft, .isPrerelease, .tagName] | @tsv' 2>/dev/null)" &&
    [[ "$release_state" == "$expected_state" ]]; then
    break
  fi

  if [[ "$attempt" -eq 20 ]]; then
    echo "The draft release did not become visible with the expected state." >&2
    exit 1
  fi

  echo "Draft release is not visible yet; retrying (${attempt}/20)." >&2
  sleep "$retry_delay_seconds"
done

for attempt in $(seq 1 5); do
  if gh release upload "$GITHUB_REF_NAME" \
    --repo "$GITHUB_REPOSITORY" \
    --clobber \
    "$@"; then
    exit 0
  fi

  if [[ "$attempt" -eq 5 ]]; then
    echo "Release asset upload failed after 5 attempts." >&2
    exit 1
  fi

  echo "Release asset upload failed; retrying (${attempt}/5)." >&2
  sleep $((attempt * retry_delay_seconds))
done
