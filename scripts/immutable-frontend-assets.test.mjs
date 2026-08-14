import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  frontendAssetOutputDirectories,
  materializeImmutableFrontendAssets,
} from "./immutable-frontend-assets.mjs";

test("immutable editor assets replace generated copies with shared files", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openpost-immutable-assets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "static");
  const output = path.join(root, "build");
  await Promise.all([
    mkdir(path.join(source, "video-editor-models"), { recursive: true }),
    mkdir(path.join(output, "video-editor-models"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(source, "video-editor-models", "model.onnx"), "canonical\n"),
    writeFile(path.join(output, "video-editor-models", "model.onnx"), "copy\n"),
    writeFile(path.join(output, "video-editor-models", "stale.onnx"), "stale\n"),
    writeFile(path.join(output, "app.js"), "app\n"),
  ]);

  await materializeImmutableFrontendAssets({
    sourceDirectory: source,
    outputDirectory: output,
  });

  const [canonical, materialized] = await Promise.all([
    stat(path.join(source, "video-editor-models", "model.onnx")),
    stat(path.join(output, "video-editor-models", "model.onnx")),
  ]);
  assert.equal(materialized.ino, canonical.ino);
  assert.equal(await readFile(path.join(output, "app.js"), "utf8"), "app\n");
  await assert.rejects(stat(path.join(output, "video-editor-models", "stale.onnx")), /ENOENT/u);
});

test("frontend asset materialization targets only generated surface trees", () => {
  assert.deepEqual(frontendAssetOutputDirectories("web", "/work/openpost"), [
    "/work/openpost/frontend/.svelte-kit/output/client",
    "/work/openpost/frontend/build",
  ]);
  assert.deepEqual(frontendAssetOutputDirectories("android", "/work/openpost"), [
    "/work/openpost/frontend/android/app/src/main/assets/public",
  ]);
});

test("missing canonical asset directories remove stale generated copies", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openpost-immutable-assets-missing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "static");
  const output = path.join(root, "build");
  await mkdir(path.join(source, "image-editor-models"), { recursive: true });
  await mkdir(path.join(output, "video-editor-models"), { recursive: true });
  await writeFile(path.join(output, "video-editor-models", "removed.onnx"), "stale\n");

  await materializeImmutableFrontendAssets({
    sourceDirectory: source,
    outputDirectory: output,
  });

  await assert.rejects(stat(path.join(output, "video-editor-models")), /ENOENT/u);
});
