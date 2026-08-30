<p align="center">
  <a href="https://openpost.social">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./assets/brand/lockup-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="./assets/brand/lockup.svg">
      <img alt="OpenPost" src="./assets/brand/lockup.svg" width="168" height="42">
    </picture>
  </a>
</p>

<p align="center">
  <strong>Your socials, on steroids.</strong>
  <br>
  Create, adapt, schedule, and track social content from one workspace.
</p>

<p align="center">
  <a href="https://github.com/getopenpost/openpost/releases">
    <img src="https://img.shields.io/github/v/release/getopenpost/openpost?label=release" alt="Latest release">
  </a>
  <a href="https://github.com/getopenpost/openpost/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/getopenpost/openpost/ci.yml?label=build" alt="Build status">
  </a>
  <a href="https://github.com/getopenpost/openpost">
    <img src="https://img.shields.io/github/stars/getopenpost/openpost" alt="GitHub stars">
  </a>
  <a href="https://github.com/getopenpost/openpost/releases">
    <img src="https://img.shields.io/github/downloads/getopenpost/openpost/total" alt="Release downloads">
  </a>
</p>

<p align="center">
  <a href="https://app.openpost.social/register?plan=founder&amp;billing_period=monthly"><strong>Start 14-day trial</strong></a>
  ·
  <a href="https://docs.openpost.social/guide/quickstart"><strong>Self-host</strong></a>
  ·
  <a href="https://docs.openpost.social"><strong>Docs</strong></a>
  ·
  <a href="https://discord.gg/u2QwukmY4W"><strong>Discord</strong></a>
</p>

<p align="center">
  <img alt="OpenPost composer with channel-specific versions, media, scheduling, and publishing controls" src="./assets/screenshots/readme-hero-dark.webp" width="94%">
</p>

Turn a launch, update, or lesson into destination-specific content, schedule it, and track what shipped. OpenPost shows each provider's limits and publishing state.

<table>
  <tr>
    <td width="50%" align="center">
      <img alt="OpenPost monthly publishing calendar with published and scheduled posts" src="./assets/screenshots/calendar-dark.webp" width="100%">
      <br><sub>Calendar</sub>
    </td>
    <td width="50%" align="center">
      <img alt="OpenPost analytics with account growth, content results, and follower trend" src="./assets/screenshots/analytics-dark.webp" width="100%">
      <br><sub>Analytics</sub>
    </td>
  </tr>
</table>

<p align="center">
  <img alt="OpenPost Image Editor with a five-page carousel, layers, and text controls" src="./assets/screenshots/image-editor-dark.webp" width="94%">
  <br><sub>OpenPost Image Editor</sub>
</p>

<p align="center">
  <img alt="OpenPost Video Editor with a populated preview, media pool, inspector, and multitrack timeline" src="./assets/screenshots/video-editor-dark.webp" width="94%">
  <br><sub>OpenPost Video Editor</sub>
</p>

## What you get

- **Channel-specific versions.** Adapt text, media, format, and timing for each account while keeping one source publication.
- **A durable queue.** Scheduled work stays in the database, with clear queued, published, failed, and retrying states.
- **One workspace.** Publications, media, calendar, analytics, and comments stay together.
- **Built-in creative tools.** Edit images, cut videos, make memes, and save the result to the Media library.
- **Consistent access.** The web app, HTTP API, CLI, and MCP use the same permissions within each workspace.

OpenPost focuses on publishing. It does not include a CRM, ad manager, or social listening. Hosted manages the service for you. Self-hosting leaves the server, backups, and provider setup to you.

## Get started

Use the [Hosted service](https://app.openpost.social) if you want OpenPost managed for you.

To run it yourself:

```bash
git clone https://github.com/getopenpost/openpost.git
cd openpost
cp .env.example .env
# Set OPENPOST_APP_URL and replace the two example secrets in .env.
docker compose up -d
```

Open `http://localhost:8080`, create the first account, and connect a social account. The default setup uses one container, SQLite, local media, and database-backed jobs. The current amd64 image is published at [`ghcr.io/getopenpost/openpost`](https://github.com/getopenpost/openpost/pkgs/container/openpost).

[Read the self-hosting quickstart](https://docs.openpost.social/guide/quickstart) · [Installation reference](https://docs.openpost.social/self-hosting/) · [Hosted and self-hosted boundary](https://openpost.social/self-hosting)

## Providers

OpenPost has adapters for X, Mastodon, Bluesky, LinkedIn profiles and company pages, Threads, Facebook Pages, Instagram, TikTok, YouTube, and Discord webhooks.

An adapter means the integration exists. It does not mean it is ready on Hosted. Some need app review, a specific account type, or extra scopes. OpenPost shows that state before you publish.

<!-- provider-certification:begin -->

The checked-in public certification manifest contains **0 exact provider-format claims**.

No Hosted service provider-format certification claim is current. Implementation descriptions do not assert Hosted service availability.
<!-- provider-certification:end -->

[Provider readiness](https://docs.openpost.social/operations/provider-launch-matrix) · [Platform limits](https://docs.openpost.social/providers/)

## Automate it

API, CLI, and MCP tokens use the same workspace permissions as the web app. They never expose social account credentials.

[CLI guide](https://docs.openpost.social/cli/) · [MCP guide](https://docs.openpost.social/mcp/) · [API reference](https://docs.openpost.social/development/api-reference)

## Develop OpenPost

OpenPost uses Go, Svelte 5, SvelteKit, Bun, and Devenv.

```bash
direnv allow
devenv shell -- setup
bun run verify
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [development docs](https://docs.openpost.social/development/setup) before opening a pull request.

## Help OpenPost grow

If OpenPost is useful to you, **star the repository**. It helps other self-hosters find the project and tells us which work is worth continuing.

<!-- star-history:start -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/star-history/star-history-dark.svg">
  <img alt="Star history" src="assets/star-history/star-history-light.svg">
</picture>
<!-- star-history:end -->

## License and security

OpenPost is licensed under [AGPL-3.0-only](LICENSE). Report vulnerabilities privately through the [security policy](SECURITY.md).
