import assert from "node:assert/strict";
import test from "node:test";
import {
  docsImageKey,
  docsRouteFromPage,
  marketingSocialEntries,
  resolveDocsSocial,
  resolveMarketingSocial,
} from "./index.js";

test("marketing social entries have unique paths, keys, and complete image metadata", () => {
  const paths = new Set();
  const keys = new Set();

  for (const entry of marketingSocialEntries) {
    assert.equal(paths.has(entry.path), false, `duplicate path ${entry.path}`);
    assert.equal(keys.has(entry.key), false, `duplicate key ${entry.key}`);
    assert.match(entry.imagePath, /^\/assets\/social\/og\/marketing\/[a-z0-9-]+\.png$/);
    assert.match(entry.canonical, /^https:\/\/openpost\.social(?:\/|$)/);
    assert.ok(entry.socialTitle.length <= 72, `${entry.key} social title is too long`);
    assert.ok(entry.description.length <= 160, `${entry.key} description is too long`);
    paths.add(entry.path);
    keys.add(entry.key);
  }
});

test("marketing paths resolve without query strings or trailing slashes", () => {
  assert.equal(resolveMarketingSocial("/pricing/").key, "pricing");
  assert.equal(resolveMarketingSocial("/tools/thread-splitter?from=x").key, "tool-thread-splitter");
  assert.equal(resolveMarketingSocial("/unknown").canonical, "https://openpost.social/unknown");
});

test("docs routes and image keys match VitePress output paths", () => {
  assert.equal(docsRouteFromPage("index.md"), "/");
  assert.equal(docsRouteFromPage("usage/index.md"), "/usage/");
  assert.equal(docsRouteFromPage("providers/x.md"), "/providers/x");
  assert.equal(docsImageKey("usage/index.md"), "usage");
  assert.equal(docsImageKey("providers/platform-limits.md"), "providers--platform-limits");

  const social = resolveDocsSocial({
    page: "providers/x.md",
    title: "X",
  });
  assert.equal(social.label, "Provider guide");
  assert.equal(social.canonical, "https://docs.openpost.social/providers/x");
  assert.equal(social.imagePath, "/assets/social/og/docs/providers--x.png");
});
