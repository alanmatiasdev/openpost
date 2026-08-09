import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPolicyEffectiveDate,
  legalPolicy,
  managedService,
} from "./index.js";

test("official policy documents use explicit independent acceptance rules", () => {
  assert.equal(legalPolicy.schema_version, 1);
  assert.equal(legalPolicy.terms.requires_acceptance, true);
  assert.equal(legalPolicy.privacy.requires_acceptance, true);
  assert.equal(legalPolicy.refunds.requires_acceptance, false);
});

test("effective dates format from the canonical ISO value", () => {
  assert.equal(formatPolicyEffectiveDate(legalPolicy.privacy), "9 August 2026");
});

test("managed-service disclosure accounts for every reviewed data path", () => {
  assert.equal(managedService.schema_version, 1);
  assert.match(managedService.contact, /^[^@]+@[^@]+$/u);
  assert.deepEqual(
    managedService.stores.map(({ id }) => id),
    ["primary-host", "recovery-copies", "media-objects", "browser-local"],
  );
  assert.deepEqual(
    managedService.providers.map(({ id }) => id),
    [
      "hetzner",
      "cloudflare",
      "purelymail",
      "paddle",
      "openrouter",
      "microsoft-azure-ai",
      "discord-feedback",
      "pexels",
      "pixabay",
      "unsplash",
    ],
  );
  assert.deepEqual(Object.keys(managedService.human_access).sort(), [
    "approval",
    "authentication",
    "emergency",
    "logging",
    "review_and_revocation",
    "routine_access",
    "scope",
    "support_access",
  ]);
});

test("managed-service facts have current reviews and safe primary sources", () => {
  const reviewedAt = Date.parse(`${managedService.reviewed_on}T00:00:00Z`);
  const nextReviewAt = Date.parse(`${managedService.next_review_on}T23:59:59Z`);
  assert.ok(Number.isFinite(reviewedAt));
  assert.ok(Number.isFinite(nextReviewAt));
  assert.ok(nextReviewAt > reviewedAt);
  assert.ok(
    Date.now() <= nextReviewAt,
    `managed-service facts require review after ${managedService.next_review_on}`,
  );

  for (const provider of managedService.providers) {
    assert.ok(provider.purpose.length > 20, `${provider.id} needs a purpose`);
    assert.ok(
      provider.data.length > 20,
      `${provider.id} needs data categories`,
    );
    assert.ok(provider.location.length > 10, `${provider.id} needs a location`);
    assert.ok(
      provider.transfer.length > 20,
      `${provider.id} needs transfer facts`,
    );
    assert.ok(provider.source_urls.length > 0, `${provider.id} needs a source`);
    for (const source of provider.source_urls) {
      const url = new URL(source);
      assert.equal(url.protocol, "https:");
      assert.equal(url.username, "");
      assert.equal(url.password, "");
      assert.equal(url.search, "");
      assert.equal(url.hash, "");
    }
  }

  const unsafeKeys = [];
  const visit = (value, path = "managedService") => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (
        /^(api_?key|client_?secret|password|token|webhook_?url)$/iu.test(key)
      ) {
        unsafeKeys.push(`${path}.${key}`);
      }
      visit(child, `${path}.${key}`);
    }
  };
  visit(managedService);
  assert.deepEqual(unsafeKeys, []);
});
