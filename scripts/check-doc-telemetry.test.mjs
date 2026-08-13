import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const docsConfigPath = new URL(
  "../docs-site/.vitepress/config.ts",
  import.meta.url,
);
const docsThemePath = new URL(
  "../docs-site/.vitepress/theme/index.ts",
  import.meta.url,
);
const telemetryGuidePath = new URL(
  "../docs-site/configuration/telemetry.md",
  import.meta.url,
);
const firstUseWorkflowPath = new URL(
  "../.github/workflows/posthog-first-use.yml",
  import.meta.url,
);

describe("documentation telemetry", () => {
  test("uses the shared PostHog client without a legacy Umami script", async () => {
    const [config, theme] = await Promise.all([
      readFile(docsConfigPath, "utf8"),
      readFile(docsThemePath, "utf8"),
    ]);

    expect(config).not.toContain("analytics.rgo.pt");
    expect(config.toLowerCase()).not.toContain("umami");
    expect(theme).toContain("configureTelemetry");
    expect(theme).toContain("surface: 'docs'");
  });

  test("documents and automates the complete production first-use funnel", async () => {
    const [guide, workflow] = await Promise.all([
      readFile(telemetryGuidePath, "utf8"),
      readFile(firstUseWorkflowPath, "utf8"),
    ]);
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
    expect(workflow).toContain("bun scripts/posthog-first-use.ts");
    expect(workflow).toContain(
      "POSTHOG_PERSONAL_API_KEY: ${{ secrets.POSTHOG_PERSONAL_API_KEY }}",
    );
    expect(workflow).toContain("posthog-first-use-evidence.json");
  });
});
