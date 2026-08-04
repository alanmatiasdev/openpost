import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { docsSiteUrl } from "@openpost/social-images";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(scriptDir, "..");
const dist = path.join(docsRoot, ".vitepress/dist");
const manifest = JSON.parse(
  await readFile(path.resolve(docsRoot, "../assets/social/og/manifest.json"), "utf8"),
);
const entries = manifest.entries.filter((entry) => entry.group === "docs");
const problems = [];

function outputFile(routePath) {
  if (routePath === "/") return path.join(dist, "index.html");
  if (routePath.endsWith("/")) return path.join(dist, routePath.slice(1), "index.html");
  return path.join(dist, `${routePath.slice(1)}.html`);
}

for (const entry of entries) {
  const file = outputFile(entry.path);
  let html;
  try {
    html = await readFile(file, "utf8");
  } catch {
    problems.push(`${entry.path}: missing prerendered docs HTML`);
    continue;
  }

  const image = `${docsSiteUrl}${entry.imagePath}`;
  for (const expected of [
    'property="og:site_name" content="OpenPost Docs"',
    'property="og:image:width" content="1200"',
    'property="og:image:height" content="630"',
    'name="twitter:card" content="summary_large_image"',
    image,
  ]) {
    if (!html.includes(expected)) problems.push(`${entry.path}: missing ${expected}`);
  }
}

if (problems.length) {
  console.error(`Docs social metadata check failed:\n${problems.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}

console.log(`Checked social metadata for ${entries.length} docs routes.`);
