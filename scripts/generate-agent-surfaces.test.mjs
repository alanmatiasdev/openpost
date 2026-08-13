import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { generateAgentSurface } from "./generate-agent-surfaces.mjs";

async function runRootTask(root, ...arguments_) {
  await new Promise((resolve, reject) => {
    const child = spawn("bun", ["run", ...arguments_], { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`bun run ${arguments_.join(" ")} exited ${code}`)),
    );
  });
}

async function fixtureDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "openpost-agent-surface-"));
}

const marketingHTML = `<!doctype html>
<html><head>
<title>OpenPost - Social publishing</title>
<meta name="description" content="Create, adapt, and publish from one workspace.">
<link rel="canonical" href="https://openpost.social">
<link rel="alternate" type="text/markdown" href="https://openpost.social/index.md">
<link rel="alternate" type="text/plain" href="https://openpost.social/llms.txt">
</head><body><nav>Navigation noise</nav><main>
<h1>Publish everywhere</h1><p>Prepare one idea for every destination.</p>
<a href="/features">See the features</a><script>privateState = true</script>
</main></body></html>`;

test("marketing production projection emits deterministic homepage Markdown and discovery", async () => {
  const directory = await fixtureDirectory();
  const htmlPath = path.join(directory, "index.html");
  await writeFile(htmlPath, marketingHTML);

  const projection = {
    surface: "marketing",
    outputDirectory: directory,
    pages: [{ sourcePath: htmlPath, outputPath: "index.md" }],
    discovery: {
      title: "OpenPost",
      description: "Create, adapt, and publish from one workspace.",
      links: [
        {
          title: "OpenPost overview",
          description: "See the product workflow.",
          url: "https://openpost.social/index.md",
        },
      ],
    },
  };

  await generateAgentSurface(projection);
  const firstMarkdown = await readFile(path.join(directory, "index.md"), "utf8");
  const firstDiscovery = await readFile(path.join(directory, "llms.txt"), "utf8");
  await generateAgentSurface(projection);

  assert.equal(await readFile(path.join(directory, "index.md"), "utf8"), firstMarkdown);
  assert.equal(await readFile(path.join(directory, "llms.txt"), "utf8"), firstDiscovery);
  assert.match(firstMarkdown, /^<!-- Generated from the canonical OpenPost public page/m);
  assert.match(firstMarkdown, /^Title: OpenPost - Social publishing$/m);
  assert.match(firstMarkdown, /^Description: Create, adapt, and publish from one workspace\.$/m);
  assert.match(firstMarkdown, /^Canonical: https:\/\/openpost\.social\/$/m);
  assert.match(firstMarkdown, /^Source: \[https:\/\/openpost\.social\/\]/m);
  assert.equal((firstMarkdown.match(/^# /gm) ?? []).length, 1);
  assert.match(firstMarkdown, /^# Publish everywhere$/m);
  assert.match(firstMarkdown, /\[See the features\]\(https:\/\/openpost\.social\/features\)/);
  assert.doesNotMatch(firstMarkdown, /Navigation noise|privateState/);
  assert.match(firstDiscovery, /^# OpenPost$/m);
  assert.match(firstDiscovery, /\[OpenPost overview\]\(https:\/\/openpost\.social\/index\.md\)/);
});

test("documentation production projection emits homepage Markdown from its canonical source", async () => {
  const directory = await fixtureDirectory();
  const sourcePath = path.join(directory, "index.md.source");
  await writeFile(
    sourcePath,
    `---
layout: home
hero:
  name: OpenPost
  text: Publish everywhere.
  tagline: One content workspace.
  actions:
    - text: Read the user guide
      link: /usage/
features:
  - title: Clear outcomes
    details: See what published and what needs attention.
---

::: info Managed plans
Managed plans start at $15 per month.
:::

## Choose the right docs

- [User docs](/usage/) explain the product.

\`\`\`yaml
services:
  openpost:
    image: ghcr.io/rodrgds/openpost:latest
\`\`\`
`,
  );

  await generateAgentSurface({
    surface: "documentation",
    outputDirectory: directory,
    pages: [
      {
        sourcePath,
        outputPath: "index.md",
        canonical: "https://docs.openpost.social/",
        title: "OpenPost Documentation",
        description: "OpenPost product and operating documentation.",
      },
    ],
    discovery: {
      title: "OpenPost Documentation",
      description: "OpenPost product and operating documentation.",
      links: [
        {
          title: "Documentation home",
          description: "Start with OpenPost documentation.",
          url: "https://docs.openpost.social/index.md",
        },
      ],
    },
  });

  const markdown = await readFile(path.join(directory, "index.md"), "utf8");
  assert.equal((markdown.match(/^# /gm) ?? []).length, 1);
  assert.match(markdown, /^# OpenPost$/m);
  assert.match(markdown, /^Publish everywhere\.$/m);
  assert.match(markdown, /^## Clear outcomes$/m);
  assert.match(markdown, /\[Read the user guide\]\(https:\/\/docs\.openpost\.social\/usage\/\)/);
  assert.match(markdown, /^> \*\*Managed plans\*\*$/m);
  assert.match(markdown, /\[User docs\]\(https:\/\/docs\.openpost\.social\/usage\/\)/);
  assert.match(markdown, /^  openpost:\n    image: ghcr\.io\/rodrgds\/openpost:latest$/m);
});

test("projection validation rejects unsafe or incomplete production contracts", async () => {
  const directory = await fixtureDirectory();
  const htmlPath = path.join(directory, "index.html");
  await writeFile(htmlPath, marketingHTML);
  const base = {
    surface: "marketing",
    outputDirectory: directory,
    pages: [{ sourcePath: htmlPath, outputPath: "index.md" }],
    discovery: {
      title: "OpenPost",
      description: "Public product information.",
      links: [
        {
          title: "OpenPost overview",
          description: "Public product information.",
          url: "https://openpost.social/index.md",
        },
      ],
    },
  };

  await assert.rejects(
    generateAgentSurface({ ...base, pages: [...base.pages, ...base.pages] }),
    /duplicate output path: index\.md/,
  );
  await assert.rejects(
    generateAgentSurface({
      ...base,
      discovery: {
        ...base.discovery,
        links: [{ ...base.discovery.links[0], url: "https://openpost.social/missing.md" }],
      },
    }),
    /discovery link has no generated artifact/,
  );
  await assert.rejects(
    generateAgentSurface({
      ...base,
      discovery: {
        ...base.discovery,
        links: [
          { ...base.discovery.links[0], url: "https://docs.openpost.social/does-not-exist.md" },
        ],
      },
    }),
    /discovery link has no generated artifact/,
  );
  await assert.rejects(
    generateAgentSurface({
      ...base,
      pages: [{ sourcePath: path.join(directory, "absent.html"), outputPath: "index.md" }],
    }),
    /missing canonical source/,
  );
  await assert.rejects(
    generateAgentSurface({
      ...base,
      discovery: {
        ...base.discovery,
        links: [{ ...base.discovery.links[0], url: "https://app.openpost.social/publications.md" }],
      },
    }),
    /private application route/,
  );
  await assert.rejects(
    generateAgentSurface({
      ...base,
      discovery: {
        ...base.discovery,
        links: [{ ...base.discovery.links[0], url: "https://app.openpost.social/workspaces" }],
      },
    }),
    /private application route/,
  );
});

test("both production builds emit canonical homepage artifacts and discovery", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const marketingPackage = JSON.parse(
    await readFile(path.join(root, "marketing-site/package.json"), "utf8"),
  );
  const docsPackage = JSON.parse(await readFile(path.join(root, "docs-site/package.json"), "utf8"));
  assert.match(marketingPackage.scripts.build, /generate-agent-surfaces\.mjs --surface marketing/);
  assert.match(docsPackage.scripts.build, /generate-agent-surfaces\.mjs --surface documentation/);

  const marketingHomepage = await readFile(
    path.join(root, "marketing-site/src/routes/+page.svelte"),
    "utf8",
  );
  assert.match(
    marketingHomepage,
    /rel="alternate" type="text\/markdown" href="https:\/\/openpost\.social\/index\.md"/,
  );
  assert.match(
    marketingHomepage,
    /rel="alternate"[\s\S]{0,80}type="text\/plain"[\s\S]{0,80}href="https:\/\/openpost\.social\/llms\.txt"/,
  );

  const docsConfig = await readFile(path.join(root, "docs-site/.vitepress/config.ts"), "utf8");
  assert.match(docsConfig, /type: "text\/markdown"/);
  assert.match(docsConfig, /href: `\$\{docsSiteUrl\}\/index\.md`/);
  assert.match(docsConfig, /type: "text\/plain"/);
  assert.match(docsConfig, /href: `\$\{docsSiteUrl\}\/llms\.txt`/);

  await runRootTask(root, "build", "--", "marketing");
  await runRootTask(root, "build", "--", "docs");

  for (const production of [
    {
      directory: path.join(root, "marketing-site/dist"),
      canonical: "https://openpost.social/",
      discoveryTarget: "https://openpost.social/index.md",
    },
    {
      directory: path.join(root, "docs-site/.vitepress/dist"),
      canonical: "https://docs.openpost.social/",
      discoveryTarget: "https://docs.openpost.social/index.md",
    },
  ]) {
    const markdown = await readFile(path.join(production.directory, "index.md"), "utf8");
    const discovery = await readFile(path.join(production.directory, "llms.txt"), "utf8");
    assert.match(markdown, /^<!-- Generated from the canonical OpenPost public page/m);
    assert.match(
      markdown,
      new RegExp(`^Canonical: ${production.canonical.replaceAll(".", "\\.")}$`, "m"),
    );
    assert.equal((markdown.match(/^# /gm) ?? []).length, 1);
    assert.ok(
      markdown.length > 500,
      `${production.canonical} Markdown must preserve useful meaning`,
    );
    assert.match(discovery, new RegExp(production.discoveryTarget.replaceAll(".", "\\.")));
  }
});
