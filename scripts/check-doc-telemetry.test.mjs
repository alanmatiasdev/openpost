import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const docsConfigPath = new URL("../docs-site/.vitepress/config.ts", import.meta.url);
const docsThemePath = new URL("../docs-site/.vitepress/theme/index.ts", import.meta.url);
const telemetryGuidePath = new URL("../docs-site/configuration/telemetry.md", import.meta.url);

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
});
