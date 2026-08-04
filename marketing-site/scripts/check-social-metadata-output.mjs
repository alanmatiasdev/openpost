import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marketingSiteUrl, marketingSocialEntries } from "@openpost/social-images";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(scriptDir, "../dist");
const problems = [];

function outputFile(routePath) {
  return routePath === "/"
    ? path.join(dist, "index.html")
    : path.join(dist, `${routePath.slice(1)}.html`);
}

function count(html, value) {
  return html.split(value).length - 1;
}

for (const entry of marketingSocialEntries) {
  const file = outputFile(entry.path);
  let html;
  try {
    html = await readFile(file, "utf8");
  } catch (error) {
    problems.push(`${entry.path}: missing prerendered HTML at ${path.relative(dist, file)}`);
    continue;
  }

  const image = `${marketingSiteUrl}${entry.imagePath}`;
  const expected = [
    ['property="og:title"', entry.socialTitle],
    ['property="og:description"', entry.description],
    ['property="og:url"', entry.canonical],
    ['property="og:image"', image],
    ['property="og:image:alt"', entry.imageAlt],
    ['name="twitter:card"', "summary_large_image"],
    ['name="twitter:image"', image],
  ];

  for (const [attribute, value] of expected) {
    if (!html.includes(attribute) || !html.includes(value)) {
      problems.push(`${entry.path}: missing ${attribute} with ${value}`);
    }
  }

  if (count(html, 'property="og:image"') !== 1) {
    problems.push(`${entry.path}: expected exactly one og:image tag`);
  }
  if (html.includes("/assets/brand/og-image.png")) {
    problems.push(`${entry.path}: still references the retired shared OG image`);
  }
}

if (problems.length) {
  console.error(`Marketing social metadata check failed:\n${problems.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}

console.log(`Checked social metadata for ${marketingSocialEntries.length} marketing routes.`);
