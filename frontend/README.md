# OpenPost Frontend

The OpenPost web app is a Svelte 5 and SvelteKit application embedded in the Go server. The same responsive build is packaged as a Capacitor Android app.

Use the repository-owned commands from the project root:

```bash
bun run check -- frontend
bun run lint -- frontend
bun run test -- frontend
bun run build -- frontend
```

The frontend uses Tailwind CSS, Paraglide translations in English and Portuguese, `openapi-fetch` with generated API types, Oxfmt, Oxlint with ESLint retained for Svelte template rules, Vitest, and Playwright. Do not hand-edit `openapi.json`, generated API types, or the Paraglide runtime; regenerate them from their source contracts.

For current architecture and workflows, see the [frontend development guide](../docs-site/development/frontend.md), [development setup](../docs-site/development/setup.md), and [Android guide](../docs-site/installation/android.md).
