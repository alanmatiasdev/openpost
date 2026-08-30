import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";
import { createMarkdownRenderer } from "vitepress";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const outputRoot =
  "/Users/rgo/.codex/visualizations/2026/08/30/01a05355-1d73-78a2-89f2-c3ee5d01a660/readme";
const markdown = await readFile(path.join(repositoryRoot, "README.md"), "utf8");
const renderer = await createMarkdownRenderer(import.meta.dirname);
const rendered = await renderer.render(markdown);

await mkdir(outputRoot, { recursive: true });

const browser = await chromium.launch();
const previews = [
  { name: "desktop-light", colorScheme: "light", width: 1280, height: 900 },
  { name: "desktop-dark", colorScheme: "dark", width: 1280, height: 900 },
  { name: "phone-light", colorScheme: "light", width: 390, height: 844 },
  { name: "phone-dark", colorScheme: "dark", width: 390, height: 844 },
];

for (const preview of previews) {
  const page = await browser.newPage({
    colorScheme: preview.colorScheme,
    viewport: { width: preview.width, height: preview.height },
  });

  await page.route("http://readme.local/**", async (route) => {
    const requestURL = new URL(route.request().url());
    if (requestURL.pathname === "/") {
      await route.fulfill({
        body: documentHTML(rendered, preview.colorScheme),
        contentType: "text/html; charset=utf-8",
        status: 200,
      });
      return;
    }

    const relativePath = decodeURIComponent(requestURL.pathname).replace(/^\/+/, "");
    const target = path.resolve(repositoryRoot, relativePath);
    if (!target.startsWith(`${repositoryRoot}${path.sep}`)) {
      await route.abort();
      return;
    }

    const file = Bun.file(target);
    if (!(await file.exists())) {
      await route.abort();
      return;
    }

    await route.fulfill({
      body: await file.arrayBuffer(),
      contentType: file.type,
      status: 200,
    });
  });
  await page.route("https://img.shields.io/**", async (route) => {
    await route.fulfill({
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="112" height="20"><rect width="112" height="20" rx="4" fill="#59636e"/></svg>',
      contentType: "image/svg+xml",
      status: 200,
    });
  });

  await page.goto("http://readme.local/", { waitUntil: "domcontentloaded" });
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('img[src^="./assets/"]')].every((image) => image.complete),
      { timeout: 10_000 },
    )
    .catch(() => undefined);
  const session = await page.context().newCDPSession(page);
  const { contentSize } = await session.send("Page.getLayoutMetrics");
  const screenshot = await session.send("Page.captureScreenshot", {
    captureBeyondViewport: true,
    clip: {
      height: Math.ceil(contentSize.height),
      scale: 1,
      width: Math.ceil(contentSize.width),
      x: 0,
      y: 0,
    },
    format: "png",
  });
  await writeFile(
    path.join(outputRoot, `${preview.name}.png`),
    Buffer.from(screenshot.data, "base64"),
  );
  await page.close();
}

await browser.close();

function documentHTML(content, theme) {
  const dark = theme === "dark";
  const background = dark ? "#0d1117" : "#ffffff";
  const foreground = dark ? "#f0f6fc" : "#1f2328";
  const muted = dark ? "#9198a1" : "#59636e";
  const border = dark ? "#3d444d" : "#d1d9e0";
  const codeBackground = dark ? "#151b23" : "#f6f8fa";
  const link = dark ? "#4493f8" : "#0969da";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenPost README preview</title>
<style>
:root { color-scheme: ${theme}; }
* { box-sizing: border-box; }
body { margin: 0; background: ${background}; color: ${foreground}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 16px; line-height: 1.5; }
.markdown-body { max-width: 1012px; margin: 0 auto; padding: 40px 32px 80px; overflow-wrap: break-word; }
a { color: ${link}; text-decoration: none; }
a:hover { text-decoration: underline; }
p, ul, pre, table { margin-top: 0; margin-bottom: 16px; }
h2 { margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 1px solid ${border}; font-size: 24px; line-height: 1.25; }
ul { padding-left: 32px; }
li + li { margin-top: 4px; }
table { display: block; width: 100%; overflow-x: auto; border-spacing: 0; border-collapse: collapse; }
td { min-width: 240px; padding: 8px; vertical-align: top; }
img { max-width: 100%; height: auto; }
sub { color: ${muted}; font-size: 12px; line-height: 1.45; }
pre { overflow: auto; padding: 16px; border-radius: 6px; background: ${codeBackground}; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 85%; }
:not(pre) > code { padding: 0.2em 0.4em; border-radius: 6px; background: ${codeBackground}; }
@media (max-width: 500px) {
	.markdown-body { padding: 24px 16px 64px; }
	h2 { margin-top: 28px; font-size: 22px; }
	td { min-width: 250px; }
}
</style>
</head>
<body><main class="markdown-body">${content}</main></body>
</html>`;
}
