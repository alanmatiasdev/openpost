import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const docsConfigPath = new URL("../docs-site/.vitepress/config.ts", import.meta.url);
const docsThemePath = new URL("../docs-site/.vitepress/theme/index.ts", import.meta.url);
const telemetryGuidePath = new URL("../docs-site/configuration/telemetry.md", import.meta.url);
const docsPackagePath = new URL("../docs-site/package.json", import.meta.url);
const marketingPackagePath = new URL("../marketing-site/package.json", import.meta.url);
const repositoryRoot = new URL("..", import.meta.url);

describe("documentation telemetry", () => {
  test("uses the shared PostHog client without a legacy Umami script", async () => {
    const [config, theme] = await Promise.all([
      readFile(docsConfigPath, "utf8"),
      readFile(docsThemePath, "utf8"),
    ]);

    expect(config).not.toContain("analytics.rgo.pt");
    expect(config.toLowerCase()).not.toContain("umami");
    expect(theme).toContain("configureTelemetry");
    expect(theme).toMatch(/surface:\s*["']docs["']/u);
  });

  test("documents the complete MCP-managed production first-use funnel", async () => {
    const guide = await readFile(telemetryGuidePath, "utf8");
    const events = [
      "signup started",
      "signup completed",
      "plan confirmed",
      "workspace created",
      "checkout completed",
      "destination connected",
      "first composition started",
      "workspace activated",
    ];
    let previous = -1;
    for (const event of events) {
      const index = guide.indexOf(`\`${event}\``);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
    expect(guide).toContain("PostHog MCP");
    expect(guide).toContain("excludes marked smoke events");
    expect(guide).not.toContain("POSTHOG_PERSONAL_API_KEY` Actions secret");
  });

  test("rejects production Cloudflare builds without public telemetry configuration", async () => {
    const [docsPackage, marketingPackage] = await Promise.all([
      readFile(docsPackagePath, "utf8"),
      readFile(marketingPackagePath, "utf8"),
    ]);
    expect(docsPackage).toContain("check-public-telemetry-env.mjs");
    expect(marketingPackage).toContain("check-public-telemetry-env.mjs");

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
});
