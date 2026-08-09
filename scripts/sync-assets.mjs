import { cp, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const source = path.join(root, "assets");
const frontendRoot = path.join(root, "frontend");

const targets = new Map([
  ["frontend", path.join(frontendRoot, "static", "assets")],
  ["docs", path.join(root, "docs-site", "public", "assets")],
  ["marketing", path.join(root, "marketing-site", "static", "assets")],
]);

const brandIconSource = path.join(source, "brand", "icon.svg");
const capacitorAssetsTarget = path.join(frontendRoot, "assets");
const lockDir = path.join(root, ".sync-assets.lock");

export async function syncAssets({ surface = "all" } = {}) {
  if (!existsSync(source)) {
    throw new Error("Missing assets/ directory");
  }
  if (surface !== "all" && !targets.has(surface)) {
    throw new Error(
      `Unknown asset surface ${JSON.stringify(surface)}; expected frontend, docs, marketing, or all`,
    );
  }

  await acquireLock();
  try {
    const selectedTargets =
      surface === "all"
        ? [...targets.entries()]
        : [[surface, targets.get(surface)]];
    for (const [, target] of selectedTargets) {
      await rm(target, { recursive: true, force: true });
      await mkdir(path.dirname(target), { recursive: true });
      await cp(source, target, { recursive: true });
      console.log(`Synced assets -> ${path.relative(root, target)}`);
    }

    if (surface === "all" || surface === "frontend") {
      if (!existsSync(brandIconSource)) {
        throw new Error("Missing brand icon at assets/brand/icon.svg");
      }
      await mkdir(capacitorAssetsTarget, { recursive: true });
      await cp(brandIconSource, path.join(capacitorAssetsTarget, "logo.svg"));
      console.log(
        "Prepared frontend/assets/logo.svg for Capacitor asset generation",
      );
    }
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await syncAssets({ surface: optionValue("--surface") ?? "all" });
}

async function acquireLock() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      await mkdir(lockDir);
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const lock = await stat(lockDir);
        if (Date.now() - lock.mtimeMs > 120_000) {
          await rm(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch (lockError) {
        if (lockError?.code !== "ENOENT") throw lockError;
      }
      await delay(100);
    }
  }
  throw new Error("Timed out waiting for the asset synchronization lock");
}
