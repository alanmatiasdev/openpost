import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  configuredNavigationTargets,
  localDocumentationTargetExists,
  repositoryRoot,
} from "./check-doc-links.mjs";

test("collects nested VitePress nav and sidebar links once", () => {
  const targets = configuredNavigationTargets({
    themeConfig: {
      nav: [
        { text: "Guide", link: "/guide/" },
        {
          text: "More",
          items: [{ text: "Studio", link: "/usage/studio" }],
        },
      ],
      sidebar: {
        "/guide/": [
          {
            text: "Guide",
            items: [
              { text: "Guide", link: "/guide/" },
              { text: "Setup", link: "/guide/setup" },
            ],
          },
        ],
      },
    },
  });

  assert.deepEqual(targets, ["/guide/", "/guide/setup", "/usage/studio"]);
});

test("every configured local VitePress navigation target resolves", async () => {
  const configFile = "docs-site/.vitepress/config.ts";
  const config = (
    await import(pathToFileURL(path.join(repositoryRoot, configFile)).href)
  ).default;
  const missing = configuredNavigationTargets(config).filter(
    (target) =>
      !localDocumentationTargetExists(repositoryRoot, configFile, target),
  );
  assert.deepEqual(missing, []);
});
