# OpenPost Mobile

Standalone Expo app for OpenPost. Native-first: native tabs (SwiftUI `TabView` on iOS, Material on Android), system styling, no web-view shell. Talks to any OpenPost server — hosted or self-hosted — over the same `/api/v1` contract as the web app.

## Run

```sh
bun install
bunx expo start        # then press i (iOS) / a (Android) or scan with Expo Go
```

Requires the [Expo Go](https://expo.dev/go) app or a dev client. No backend changes are needed; point it at any running OpenPost instance.

## What's in v1

- **Connect**: OpenPost hosted by default, or enter a self-hosted URL (validated against `GET /api/v1/ready`).
- **Sign in**: email + password with TOTP follow-up, or **device pairing** (`/cli/auth/start|poll`) for SSO organizations — approve in any signed-in browser, get a 90-day scoped bearer token.
- **Workspace picker** after sign-in.
- **Drafts tab**: quick idea capture (creates a draft instantly), draft list, full composer.
- **Composer**: title/text, social-set and per-account destination selection, per-platform text overrides, datetime or next-slot scheduling, publish now, delete. Optimistic-concurrency aware (`expected_revision`, 409 handling).
- **Photos**: attach from library or camera in the composer; reorder/remove thumbnails; uploaded through the direct-upload session flow and attached to the publication in order.
- **Share capture**: share text, links, or images from any app into OpenPost to start a draft. Requires a **development build** (`bunx expo run:ios` / `run:android`) because the share extension is native — it does not work in Expo Go.
- **Calendar tab**: month grid fed by `calendar_from/calendar_before`, status dots, day sheet, same occurrence rules as the web app.
- **Queue tab**: upcoming and failed sections with inline retry of failed destinations.
- **Post detail**: per-rendition provider truth (status, error message, retry-at), reschedule, cancel, retry, delete, open published URLs.

Settings intentionally live on the web: "Open web app" in the Drafts menu.

## Architecture

- `src/lib/server.ts` — server config store (SecureStore-backed, subscribable)
- `src/lib/api/token-store.ts` — bearer token + selected workspace
- `src/lib/api/client.ts` — typed `openapi-fetch` client rebuilt when server/token changes
- `src/lib/api/schema.d.ts` — generated from `frontend/openapi.json`; regenerate with `bun run generate:api`
- `src/lib/auth.ts` — login/TOTP/pairing flows
- `src/lib/media.ts` — direct-upload session flow (create → binary upload → complete)
- `src/lib/share.ts` — stash for files arriving via the OS share sheet
- `src/app/` — expo-router routes: `(tabs)` = native tabs, modals for compose/detail

## Checks

```sh
bun run generate:api   # regenerate types after backend contract changes
bunx tsc --noEmit      # typecheck
bunx eslint src        # lint
CI=1 bunx expo export --platform ios   # bundle proof
```
