import { constants } from "node:fs";
import { copyFile, link, lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const immutableFrontendAssetDirectories = [
  "image-editor-models",
  "video-editor-audio",
  "video-editor-models",
];

const linkFallbackCodes = new Set(["EACCES", "EMLINK", "ENOSYS", "ENOTSUP", "EPERM", "EXDEV"]);

async function pathExists(pathname) {
  try {
    await lstat(pathname);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function linkTree(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await linkTree(sourcePath, destinationPath);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Immutable frontend assets contain an unsupported entry: ${sourcePath}`);
    }
    try {
      await link(sourcePath, destinationPath);
    } catch (error) {
      if (!linkFallbackCodes.has(error?.code)) throw error;
      await copyFile(sourcePath, destinationPath, constants.COPYFILE_FICLONE);
    }
  }
}

export async function materializeImmutableFrontendAssets({ sourceDirectory, outputDirectory }) {
  const sourceRoot = path.resolve(sourceDirectory);
  const outputRoot = path.resolve(outputDirectory);
  if (sourceRoot === outputRoot) {
    throw new Error(`Immutable frontend asset source and output must differ: ${sourceRoot}`);
  }

  for (const directory of immutableFrontendAssetDirectories) {
    const source = path.join(sourceRoot, directory);
    if (!(await pathExists(source))) {
      throw new Error(`Missing canonical immutable frontend asset directory: ${source}`);
    }
  }

  for (const directory of immutableFrontendAssetDirectories) {
    const source = path.join(sourceRoot, directory);
    const destination = path.join(outputRoot, directory);
    await rm(destination, { recursive: true, force: true });
    await linkTree(source, destination);
  }
}

export function frontendAssetOutputDirectories(surface, root = repositoryRoot) {
  if (surface === "web") {
    return [
      path.join(root, "frontend/.svelte-kit/output/client"),
      path.join(root, "frontend/build"),
    ];
  }
  if (surface === "android") {
    return [path.join(root, "frontend/android/app/src/main/assets/public")];
  }
  throw new Error(`Unsupported immutable frontend asset surface: ${surface}`);
}

export async function materializeFrontendSurfaceAssets(surface, root = repositoryRoot) {
  const sourceDirectory = path.join(root, "frontend/static");
  for (const outputDirectory of frontendAssetOutputDirectories(surface, root)) {
    await materializeImmutableFrontendAssets({ sourceDirectory, outputDirectory });
  }
}

if (import.meta.main) {
  const [surface, ...rest] = process.argv.slice(2);
  if (!surface || rest.length > 0) {
    throw new Error("Usage: bun scripts/immutable-frontend-assets.mjs <web|android>");
  }
  await materializeFrontendSurfaceAssets(surface);
}
