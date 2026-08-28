import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
const repositoryRoot = new URL("..", import.meta.url);

describe("documentation telemetry", () => {
  test("rejects production Cloudflare builds without public telemetry configuration", () => {
    const result = spawnSync("bun", ["scripts/check-public-telemetry-env.mjs"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CF_PAGES: "1",
        CF_PAGES_BRANCH: "main",
        VITE_POSTHOG_PROJECT_TOKEN: "",
        VITE_POSTHOG_API_HOST: "",
        VITE_POSTHOG_UI_HOST: "",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("VITE_POSTHOG_PROJECT_TOKEN");
    expect(result.stderr).toContain("VITE_POSTHOG_API_HOST");
    expect(result.stderr).toContain("VITE_POSTHOG_UI_HOST");
  });

  test("requires the managed PostHog proxy and EU interface for canonical production builds", () => {
    const result = spawnSync("bun", ["scripts/check-public-telemetry-env.mjs"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CF_PAGES: "",
        CF_PAGES_BRANCH: "",
        VITE_OPENPOST_ENVIRONMENT: "production",
        VITE_POSTHOG_PROJECT_TOKEN: "phc_test",
        VITE_POSTHOG_API_HOST: "https://example.com",
        VITE_POSTHOG_UI_HOST: "https://us.posthog.com",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("https://cool.openpost.social");
  });

  test("allows local development without public telemetry configuration", () => {
    const result = spawnSync("bun", ["scripts/check-public-telemetry-env.mjs"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CF_PAGES: "",
        CF_PAGES_BRANCH: "",
        VITE_OPENPOST_ENVIRONMENT: "",
        VITE_POSTHOG_PROJECT_TOKEN: "",
        VITE_POSTHOG_API_HOST: "",
        VITE_POSTHOG_UI_HOST: "",
      },
    });
    expect(result.status).toBe(0);
  });
});
