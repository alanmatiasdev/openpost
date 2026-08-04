import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  docsDescriptionForPage,
  marketingSocialEntries,
  resolveDocsSocial,
} from "../../packages/social-images/src/index.js";
import { renderSocialImageSvg, socialRendererVersion } from "./render.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "../..");
const outputRoot = path.join(root, "assets/social/og");
const manifestPath = path.join(outputRoot, "manifest.json");
const fontPath = path.join(
  root,
  "frontend/node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
);
const screenshotPath = path.join(root, "assets/screenshots/main-dark.png");
const checkOnly = process.argv.includes("--check");
const force = process.argv.includes("--force");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function walkMarkdown(directory, relative = "") {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["node_modules", "public", ".vitepress", "dist"].includes(entry.name)) continue;
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await walkMarkdown(directory, next)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(next.replaceAll(path.sep, "/"));
  }
  return files;
}

function cleanMarkdownTitle(value) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/[\*_]/g, "")
    .trim();
}

function titleFromMarkdown(page, source) {
  if (page === "index.md") return "OpenPost documentation";
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---/);
  const frontmatterTitle = frontmatter?.[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1];
  if (frontmatterTitle) return cleanMarkdownTitle(frontmatterTitle);
  const heading = source.match(/^#\s+(.+)$/m)?.[1];
  if (heading) return cleanMarkdownTitle(heading);
  return cleanMarkdownTitle(path.basename(page, ".md").replaceAll("-", " "));
}

function descriptionFromMarkdown(page, source) {
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---/);
  const description = frontmatter?.[1].match(
    /^description:\s*["']?(.+?)["']?\s*$/m,
  )?.[1];
  return description?.trim() || docsDescriptionForPage(page);
}

async function docsEntries() {
  const docsRoot = path.join(root, "docs-site");
  const pages = await walkMarkdown(docsRoot);
  return Promise.all(
    pages.map(async (page) => {
      const source = await readFile(path.join(docsRoot, page), "utf8");
      return resolveDocsSocial({
        page,
        title: titleFromMarkdown(page, source),
        description: descriptionFromMarkdown(page, source),
      });
    }),
  );
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function platformIconDataUrls() {
  const slugs = [
    "x",
    "mastodon",
    "bluesky",
    "linkedin",
    "threads",
    "facebook",
    "instagram",
    "tiktok",
    "youtube",
    "discord",
  ];
  const values = await Promise.all(
    slugs.map(async (slug) => {
      const svg = await readFile(path.join(root, `assets/logos/${slug}.svg`), "utf8");
      return [slug, `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`];
    }),
  );
  return new Map(values);
}

async function loadPreviousManifest() {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 0, entries: [] };
    throw error;
  }
}

export async function generateSocialImages() {
  const fontBuffer = await readFile(fontPath);
  const fontData = fontBuffer.toString("base64");
  const fontHash = sha256(fontBuffer);
  const iconUrls = await platformIconDataUrls();
  const docs = await docsEntries();
  const specs = [
    ...marketingSocialEntries.map((entry) => ({ ...entry, group: "marketing" })),
    ...docs.map((entry) => ({ ...entry, group: "docs" })),
  ];
  const previous = await loadPreviousManifest();
  const previousById = new Map(previous.entries?.map((entry) => [`${entry.group}/${entry.key}`, entry]));
  const screenshotHref = pathToFileURL(screenshotPath).href;
  const nextEntries = [];
  const pending = [];

  for (const spec of specs) {
    const iconHref = spec.platform ? iconUrls.get(spec.platform) : undefined;
    const assets = {
      fontData,
      screenshotHref: spec.kind === "home" ? screenshotHref : undefined,
      platformIconHref: iconHref,
      platformIcons: spec.kind === "platforms" ? [...iconUrls.values()] : undefined,
    };
    const svg = renderSocialImageSvg(spec, assets);
    const hash = sha256(
      JSON.stringify({ version: socialRendererVersion, fontHash, spec, svg }),
    );
    const relativeBase = path.posix.join(spec.group, spec.key);
    const svgPath = path.join(outputRoot, `${relativeBase}.svg`);
    const pngPath = path.join(outputRoot, `${relativeBase}.png`);
    const previousEntry = previousById.get(`${spec.group}/${spec.key}`);
    const unchanged =
      !force &&
      previousEntry?.hash === hash &&
      (await exists(svgPath)) &&
      (await exists(pngPath));

    const manifestEntry = {
      group: spec.group,
      key: spec.key,
      path: spec.path,
      title: spec.socialTitle,
      label: spec.label,
      imagePath: spec.imagePath,
      width: 1200,
      height: 630,
      hash,
    };
    nextEntries.push(manifestEntry);
    if (!unchanged) pending.push({ spec, svg, svgPath, pngPath });
  }

  if (checkOnly) {
    const problems = [];
    if (pending.length) problems.push(`${pending.length} social image(s) are stale or missing`);
    for (const entry of nextEntries) {
      const pngPath = path.join(outputRoot, entry.group, `${entry.key}.png`);
      if (!(await exists(pngPath))) continue;
      const dimensions = pngDimensions(await readFile(pngPath));
      if (dimensions?.width !== 1200 || dimensions?.height !== 630) {
        problems.push(`${entry.group}/${entry.key}.png is not 1200x630`);
      }
    }
    if (problems.length) throw new Error(problems.join("\n"));
    console.log(`Checked ${nextEntries.length} current social images.`);
    return;
  }

  if (pending.length) {
    await mkdir(outputRoot, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    try {
      for (const item of pending) {
        await mkdir(path.dirname(item.svgPath), { recursive: true });
        await writeFile(item.svgPath, item.svg);
        const page = await browser.newPage({
          viewport: { width: 1200, height: 630 },
          deviceScaleFactor: 1,
        });
        try {
          await page.goto(pathToFileURL(item.svgPath).href, { waitUntil: "load" });
          await page.evaluate(() => document.fonts.ready);
          await page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              ),
          );
          await page.screenshot({ path: item.pngPath, type: "png" });
        } finally {
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  }

  const expected = new Set(
    nextEntries.flatMap((entry) => [
      path.join(outputRoot, entry.group, `${entry.key}.svg`),
      path.join(outputRoot, entry.group, `${entry.key}.png`),
    ]),
  );
  for (const old of previous.entries ?? []) {
    for (const extension of ["svg", "png"]) {
      const oldPath = path.join(outputRoot, old.group, `${old.key}.${extension}`);
      if (!expected.has(oldPath) && (await exists(oldPath))) await rm(oldPath);
    }
  }

  await writeFile(
    manifestPath,
    `${JSON.stringify({ version: socialRendererVersion, generatedAt: new Date().toISOString(), entries: nextEntries }, null, 2)}\n`,
  );
  console.log(
    pending.length
      ? `Rendered ${pending.length} of ${nextEntries.length} social images.`
      : `Social images are current (${nextEntries.length} total).`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await generateSocialImages();
}
