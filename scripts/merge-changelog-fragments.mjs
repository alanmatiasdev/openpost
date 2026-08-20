import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const changesDir = resolve("changes");
const changelogPath = resolve("CHANGELOG.md");

const fragmentPattern = /^.+\.md$/u;
const groupPattern = /^#{2,3} (.+)$/u;
const itemPattern = /^-\s+(.+)$/u;

const entries = readdirSync(changesDir).filter((name) => fragmentPattern.test(name));
if (entries.length === 0) {
  process.stdout.write("changelog: no fragments to merge\n");
  process.exit(0);
}

const byGroup = new Map();
for (const entry of entries) {
  const content = readFileSync(resolve(changesDir, entry), "utf8");
  let currentGroup = null;
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const groupMatch = groupPattern.exec(line);
    if (groupMatch) {
      currentGroup = groupMatch[1];
      continue;
    }
    const itemMatch = itemPattern.exec(line);
    if (itemMatch && currentGroup) {
      const items = byGroup.get(currentGroup) ?? [];
      items.push(itemMatch[1]);
      byGroup.set(currentGroup, items);
    }
  }
}

if (byGroup.size === 0) {
  process.stdout.write("changelog: fragments had no items\n");
  process.exit(0);
}

const changelog = readFileSync(changelogPath, "utf8");
const marker = "## [Unreleased]";
const markerIndex = changelog.indexOf(marker);
if (markerIndex < 0) {
  process.stderr.write("changelog: CHANGELOG.md is missing [Unreleased]\n");
  process.exit(1);
}

const bodyStart = markerIndex + marker.length;
const nextSection = changelog.slice(bodyStart).search(/\n## \[/u);
const bodyEnd = nextSection < 0 ? changelog.length : bodyStart + nextSection;
const unreleased = changelog.slice(bodyStart, bodyEnd);

const groupHeaderPattern = /^### (.+)$/mu;
const existingGroups = new Map();
let match;
while ((match = groupHeaderPattern.exec(unreleased)) !== null) {
  existingGroups.set(match[1], match.index + bodyStart);
}

const insertionPoints = [];
for (const [group, items] of byGroup) {
  const existing = existingGroups.get(group);
  if (existing !== undefined) {
    insertionPoints.push({ offset: existing, group, items });
  } else {
    insertionPoints.push({ offset: bodyEnd, group, items });
  }
}

insertionPoints.sort((a, b) => b.offset - a.offset);

let result = changelog;
const newGroups = [];
for (const { offset, group, items } of insertionPoints) {
  if (!existingGroups.has(group)) {
    newGroups.push({ offset, group, items });
    continue;
  }
  const block = items.map((item) => `- ${item}`).join("\n") + "\n";
  const lineEnd = result.indexOf("\n", offset);
  const insertAt = lineEnd < 0 ? result.length : lineEnd + 1;
  result = result.slice(0, insertAt) + block + result.slice(insertAt);
}

if (newGroups.length > 0) {
  newGroups.sort((a, b) => a.offset - b.offset);
  const newBlock =
    "\n" +
    newGroups
      .map(({ group, items }) => `### ${group}\n${items.map((item) => `- ${item}`).join("\n")}`)
      .join("\n") +
    "\n";
  result = result.slice(0, bodyEnd) + newBlock + result.slice(bodyEnd);
}

writeFileSync(changelogPath, result);
for (const entry of entries) unlinkSync(resolve(changesDir, entry));
process.stdout.write(`changelog: merged ${entries.length} fragment(s)\n`);
