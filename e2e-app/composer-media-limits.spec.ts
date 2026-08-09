import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const providers = ["mastodon", "linkedin", "x", "bluesky", "threads"];
const mediaItems = Array.from({ length: 5 }, (_, index) => ({
  id: `media-${index + 1}`,
  original_filename: `draft-image-${index + 1}.png`,
  mime_type: "image/png",
  size: 128,
  width: 1,
  height: 1,
  url: "/assets/logo.svg",
  thumbnail_url: "/assets/logo.svg",
  processing_status: "ready",
  analysis_status: "ready",
  asset_kind: "library",
  created_at: "2026-08-03T12:00:00Z",
}));

function account(provider: string) {
  return {
    id: `${provider}-main`,
    slug: `${provider}-main`,
    platform: provider,
    account_id: `${provider}-user`,
    account_username: `openpost_${provider}`,
    account_avatar_url: "",
    instance_url: provider === "mastodon" ? "https://mastodon.social" : "",
    is_active: true,
    thread_replies_supported: true,
  };
}

function healthyPublicationReadiness() {
  return {
    state: "healthy",
    executable: true,
    connectable: false,
    publishable: true,
    advertisable: false,
    facts: {
      configuration: "configured",
      local_test: "passed",
      live_certification: "passed",
      approval: "approved",
      authorization: "authorized",
      control: "enabled",
      policy: "allowed",
    },
    blockers: [],
  };
}

function resolvedCapability(provider: string) {
  return {
    account_id: `${provider}-main`,
    provider,
    profile: "image_post",
    output_profile: `${provider}.image`,
    label: `${provider} image`,
    text_limit: provider === "bluesky" ? 300 : 500,
    media: {
      min_count: 1,
      max_count: 1,
      allowed_mimes: ["image/png"],
      requires_public_url: provider === "threads",
      requires_https_fetchable: provider === "threads",
    },
    intents: ["post"],
    media_shapes: ["single_image"],
    settings: [],
    setting_groups: [],
    compatible: true,
    active_constraints: { media_shape: "single_image" },
    issues: [],
    capability_revision: "composer-media-test-v1",
    dynamic_options: {},
    immediate_readiness: healthyPublicationReadiness(),
    scheduled_readiness: healthyPublicationReadiness(),
  };
}

test("Post drafts can move from one image to multiple before destination validation", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `composer-media-${unique}@example.com`,
  );
  await createWorkspace(request, auth.token, "Composer media limits E2E");
  await authenticatePage(page, auth.token);

  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: providers.map(account),
    });
  });
  await page.route("**/api/v1/capabilities/resolve", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { accounts: providers.map(resolvedCapability) },
    });
  });
  const captionRequests: string[] = [];
  const captionPostContexts = new Map<string, string>();
  await page.route("**/api/v1/media**", async (route) => {
    const url = new URL(route.request().url());
    const captionMatch = url.pathname.match(
      /\/media\/([^/]+)\/alt-text\/generate$/,
    );
    if (captionMatch) {
      const mediaID = captionMatch[1];
      captionRequests.push(mediaID);
      const requestBody = route.request().postDataJSON() as {
        post_context?: string;
      };
      captionPostContexts.set(mediaID, requestBody.post_context ?? "");
      await route.fulfill({
        contentType: "application/json",
        json: {
          alt_text: `Generated description for ${mediaID}.`,
          generated: true,
          model: "openai/gpt-5.6-luna",
        },
      });
      return;
    }
    if (url.pathname.endsWith("/media/tags")) {
      await route.fulfill({
        contentType: "application/json",
        json: { tags: [], can_edit: true },
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { media: mediaItems, total: mediaItems.length },
    });
  });
  await page.route("**/api/v1/posts/draft", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        post_id: "post-1",
        publication_id: "publication-1",
        revision: 1,
        updated_at: "2026-08-03T12:00:00Z",
      },
    });
  });
  await page.route("**/api/v1/posts/post-1/draft", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        post_id: "post-1",
        publication_id: "publication-1",
        revision: 2,
        updated_at: "2026-08-03T12:00:01Z",
      },
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("composer-account-row")).toHaveCount(0);
  const composer = page.getByTestId("text-thread-composer-shell");
  const postText = "We are launching the new OpenPost media workflow today.";
  await composer.getByRole("textbox", { name: "Post text" }).fill(postText);

  await composer.getByRole("button", { name: "Add media" }).click();
  const picker = page.getByRole("dialog");
  await expect(picker).toContainText("0 of 35 selected");
  await expect(picker.getByRole("tab", { name: "Device" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await picker.getByRole("tab", { name: "Library" }).click();
  await picker
    .getByRole("button", { name: "Select draft-image-1.png" })
    .click();
  await picker.getByRole("button", { name: "Add media", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove media" })).toHaveCount(
    1,
  );
  await expect.poll(() => [...captionRequests]).toEqual(["media-1"]);
  expect(captionPostContexts.get("media-1")).toBe(postText);
  await composer.getByRole("button", { name: "Alt text" }).click();
  await expect(composer.getByRole("textbox", { name: "Alt text" })).toHaveValue(
    "Generated description for media-1.",
  );
  await expect(composer).toContainText(
    "AI-generated — review before publishing.",
  );
  await composer.getByRole("button", { name: "Done" }).click();

  await composer.getByRole("button", { name: "Add media" }).click();
  await expect(picker).toContainText("1 of 35 selected");
  await picker.getByRole("tab", { name: "Library" }).click();
  for (let index = 2; index <= 5; index += 1) {
    await picker
      .getByRole("button", { name: `Select draft-image-${index}.png` })
      .click();
  }
  await picker.getByRole("button", { name: "Add media", exact: true }).click();

  await expect(page.getByRole("button", { name: "Remove media" })).toHaveCount(
    5,
  );
  await expect
    .poll(() => [...captionRequests].sort())
    .toEqual(mediaItems.map((item) => item.id).sort());
  expect([...captionPostContexts.values()]).toEqual(
    mediaItems.map(() => postText),
  );
  await page.getByTestId("composer-account-control").click();
  await expect(page.getByTestId("composer-account-row")).toHaveCount(5);
  await expect(
    page.getByTestId("composer-account-row").filter({ hasText: "openpost_x" }),
  ).toContainText("Needs attention");
  await expect(
    page
      .getByTestId("composer-account-row")
      .filter({ hasText: "openpost_bluesky" }),
  ).toContainText("Needs attention");
  await expect(
    page
      .getByTestId("composer-account-row")
      .filter({ hasText: "openpost_linkedin" }),
  ).not.toContainText("Needs attention");
  await expect(
    page
      .getByTestId("composer-account-row")
      .filter({ hasText: "openpost_threads" }),
  ).not.toContainText("Needs attention");
});
