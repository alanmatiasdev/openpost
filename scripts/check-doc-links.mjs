import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const excludedPrefixes = [
  ".agents/",
  ".hermes/",
  "docs/research/",
  "frontend/static/image-editor-models/",
];

export function configuredNavigationTargets(config) {
  const targets = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.link === "string") targets.add(value.link);
    if (Array.isArray(value.items)) visit(value.items);
  };

  visit(config?.themeConfig?.nav);
  for (const sidebar of Object.values(config?.themeConfig?.sidebar ?? {})) {
    visit(sidebar);
  }
  return [...targets].sort();
}

export function localDocumentationCandidates(root, sourceFile, rawTarget) {
  const target = rawTarget.replace(/^<|>$/g, "");
  if (/^(?:https?:|mailto:|tel:|data:|#)/i.test(target)) return [];

  let localTarget;
  try {
    localTarget = decodeURIComponent(target.split("#")[0].split("?")[0]);
  } catch {
    return [path.join(root, "__invalid_encoded_documentation_target__")];
  }
  if (!localTarget) return [];

  const sourcePath = path.join(root, sourceFile);
  const bases =
    localTarget.startsWith("/") && sourceFile.startsWith("docs-site/")
      ? [
          path.join(root, "docs-site", localTarget),
          path.join(root, "docs-site/public", localTarget),
          ...(localTarget === "/openapi.json"
            ? [path.join(root, "frontend/openapi.json")]
            : []),
        ]
      : [path.resolve(path.dirname(sourcePath), localTarget)];
  return bases.flatMap((base) => [
    base,
    `${base}.md`,
    path.join(base, "README.md"),
    path.join(base, "index.md"),
  ]);
}

export function localDocumentationTargetExists(root, sourceFile, target) {
  const candidates = localDocumentationCandidates(root, sourceFile, target);
  return (
    candidates.length === 0 ||
    candidates.some((candidate) => existsSync(candidate))
  );
}

function markdownTargets(contents) {
  return [
    ...[...contents.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(
      (match) => match[1],
    ),
    ...[
      ...contents.matchAll(/<(?:a|img)\b[^>]*(?:href|src)=["']([^"']+)["']/gi),
    ].map((match) => match[1]),
    ...[...contents.matchAll(/^\[[^\]]+\]:\s*(\S+)/gm)].map(
      (match) => match[1],
    ),
  ];
}

async function main() {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((file) => existsSync(path.join(repositoryRoot, file)))
    .filter(
      (file) => !excludedPrefixes.some((prefix) => file.startsWith(prefix)),
    );

  const failures = [];
  for (const file of files) {
    const contents = readFileSync(path.join(repositoryRoot, file), "utf8");
    for (const target of markdownTargets(contents)) {
      if (!localDocumentationTargetExists(repositoryRoot, file, target)) {
        failures.push(`${file} -> ${target}`);
      }
    }
  }

  const configFile = "docs-site/.vitepress/config.ts";
  const docsConfig = (
    await import(pathToFileURL(path.join(repositoryRoot, configFile)).href)
  ).default;
  const navigationTargets = configuredNavigationTargets(docsConfig);
  for (const target of navigationTargets) {
    if (!localDocumentationTargetExists(repositoryRoot, configFile, target)) {
      failures.push(`${configFile} -> ${target}`);
    }
  }

  if (failures.length > 0) {
    console.error(`Broken local documentation links:\n${failures.join("\n")}`);
    process.exit(1);
  }

  console.log(
    `Checked local links in ${files.length} maintained Markdown files and ${navigationTargets.length} configured navigation targets.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
