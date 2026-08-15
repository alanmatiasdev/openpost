import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  copyFrontendWithoutImmutableAssets,
  validateImmutableFrontendAssets,
} from "./immutable-frontend-assets.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseCapacitorSyncArguments(args) {
  if (args.length === 1 && args[0] === "android") return "android";
  throw new Error("Usage: bun scripts/capacitor-sync.mjs android");
}

export async function runCapacitorSync(platform) {
  const frontendDirectory = path.join(repositoryRoot, "frontend");
  const staticDirectory = path.join(frontendDirectory, "static");
  await validateImmutableFrontendAssets(staticDirectory);
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "openpost-capacitor-web-"));
  let exitStatus;
  try {
    const webDirectory = path.join(temporaryRoot, "build");
    await copyFrontendWithoutImmutableAssets({
      sourceDirectory: path.join(frontendDirectory, "build"),
      outputDirectory: webDirectory,
    });
    const requireFromFrontend = createRequire(path.join(frontendDirectory, "package.json"));
    const capacitorPackage = requireFromFrontend.resolve("@capacitor/cli/package.json");
    const result = spawnSync(
      process.execPath,
      [path.join(path.dirname(capacitorPackage), "bin/capacitor"), "sync", platform],
      {
        cwd: frontendDirectory,
        env: { ...process.env, OPENPOST_CAPACITOR_WEB_DIR: webDirectory },
        stdio: "inherit",
      },
    );
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`Capacitor sync stopped by signal ${result.signal}`);
    exitStatus = result.status ?? 1;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  if (exitStatus !== 0) process.exit(exitStatus);
}

const isEntrypoint =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isEntrypoint) {
  await runCapacitorSync(parseCapacitorSyncArguments(process.argv.slice(2)));
}
