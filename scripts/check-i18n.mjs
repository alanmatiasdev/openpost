import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const messagesDirectory = path.join(root, "frontend", "messages");
const settings = JSON.parse(
  await readFile(path.join(root, "frontend", "project.inlang", "settings.json"), "utf8"),
);
const locales = settings.locales;
const catalogs = new Map();

for (const locale of locales) {
  const content = await readFile(path.join(messagesDirectory, `${locale}.json`), "utf8");
  catalogs.set(locale, JSON.parse(content));
}

const referenceLocale = settings.baseLocale;
const referenceCatalog = catalogs.get(referenceLocale);
const referenceKeys = new Set(Object.keys(referenceCatalog));
let failed = false;

function placeholders(message) {
  return [
    ...new Set([...message.matchAll(/\{([A-Za-z][\w]*)\b[^}]*\}/g)].map((match) => match[1])),
  ].sort();
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

for (const locale of locales.filter((locale) => locale !== referenceLocale)) {
  const catalog = catalogs.get(locale);
  const keys = new Set(Object.keys(catalog));
  const missing = [...referenceKeys].filter((key) => !keys.has(key)).sort();
  const extra = [...keys].filter((key) => !referenceKeys.has(key)).sort();

  if (missing.length > 0 || extra.length > 0) {
    failed = true;
    console.error(`${locale}.json does not match ${referenceLocale}.json:`);
    if (missing.length > 0) console.error(`  Missing: ${missing.join(", ")}`);
    if (extra.length > 0) console.error(`  Extra: ${extra.join(", ")}`);
  }

  const placeholderMismatches = [...referenceKeys].filter(
    (key) =>
      key in catalog && !sameList(placeholders(referenceCatalog[key]), placeholders(catalog[key])),
  );
  if (placeholderMismatches.length > 0) {
    failed = true;
    console.error(`${locale}.json changes placeholders used by ${referenceLocale}.json:`);
    for (const key of placeholderMismatches) {
      console.error(
        `  ${key}: expected {${placeholders(referenceCatalog[key]).join(", ")}}, found {${placeholders(catalog[key]).join(", ")}}`,
      );
    }
  }
}

if (failed) process.exit(1);
console.log(`Translation catalogs match (${referenceKeys.size} messages per locale).`);
