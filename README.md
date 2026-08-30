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
  Write it once. Make it fit. Pick a time. See what worked.
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
  <img alt="OpenPost with one post ready for several social apps" src="./assets/screenshots/readme-hero-dark.webp" width="94%">
</p>

One place for your posts, pictures, videos, calendar, results, and replies. Start with an idea. Make it fit each app. Pick a time. See what happened.

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

<table>
  <tr>
    <td width="50%" align="center">
      <img alt="OpenPost Image Editor with a selected logo over a Lisbon tram photo" src="./assets/screenshots/image-editor-dark.webp" width="100%">
      <br><sub>Image Editor</sub>
    </td>
    <td width="50%" align="center">
      <img alt="OpenPost Video Editor cutting a Study SOS screen recording" src="./assets/screenshots/video-editor-dark.webp" width="100%">
      <br><sub>Video Editor</sub>
    </td>
  </tr>
</table>

## What you can do

- Write one post, then tweak it for each social app.
- Add pictures, clips, and links.
- Put posts on the calendar.
- Make images, cut videos, and make memes.
- See what went out, what failed, and how each post did.
- Read and answer comments.

OpenPost is for posting. It does not manage sales, ads, or every mention of your name.

## Try it

The fastest way in is [OpenPost Hosted](https://app.openpost.social). We run it for you.

Want to run it yourself?

```bash
git clone https://github.com/getopenpost/openpost.git
cd openpost
cp .env.example .env
# Set OPENPOST_APP_URL and replace the two sample secrets in .env.
docker compose up -d
```

Open `http://localhost:8080`, make your first account, and connect a social app.

[Self-hosting guide](https://docs.openpost.social/guide/quickstart) · [Install help](https://docs.openpost.social/self-hosting/) · [Hosted or self-hosted?](https://openpost.social/self-hosting)

## Where you can post

OpenPost can connect to X, Mastodon, Bluesky, LinkedIn, Threads, Facebook Pages, Instagram, TikTok, YouTube, and Discord.

Each social app has its own rules. Some must approve the connection first. Others need a certain kind of account. OpenPost tells you what is missing before you try to post.

<!-- provider-certification:begin -->

OpenPost Hosted has passed our full live check for **0 ways to post**.

Nothing is marked ready on OpenPost Hosted yet. A connection may be in the code before it is ready for real accounts.
<!-- provider-certification:end -->

[Social app readiness](https://docs.openpost.social/operations/provider-launch-matrix) · [Posting limits](https://docs.openpost.social/providers/)

## Build with it

Use the API, CLI, or MCP server to make posts, plan them, and check them. They can do only what your OpenPost account can do. They never show your social app login details.

[CLI guide](https://docs.openpost.social/cli/) · [MCP guide](https://docs.openpost.social/mcp/) · [API reference](https://docs.openpost.social/development/api-reference)

## Work on OpenPost

OpenPost is built with Go, Svelte 5, SvelteKit, Bun, and Devenv.

```bash
direnv allow
devenv shell -- setup
bun run verify
```

Before you open a pull request, read [CONTRIBUTING.md](CONTRIBUTING.md) and the [setup guide](https://docs.openpost.social/development/setup).

## Help OpenPost grow

If OpenPost saves you time, **star the repo**. It helps more people find it.

<!-- star-history:start -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/star-history/star-history-dark.svg">
  <img alt="Star history" src="assets/star-history/star-history-light.svg">
</picture>
<!-- star-history:end -->

## License and security

OpenPost uses the [AGPL-3.0-only license](LICENSE). Report security bugs privately through the [security policy](SECURITY.md).
