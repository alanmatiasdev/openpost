import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const captureEnabled = process.env.OPENPOST_UPDATE_PRODUCT_SCREENSHOTS === "1";
const screenshotDirectory = fileURLToPath(new URL("../assets/screenshots/", import.meta.url));
const captureViewport = { width: 1440, height: 960 };
const fixedNow = "2026-07-21T14:30:00.000Z";

const connectedAccounts = [
  {
    id: "account-x",
    slug: "northstar-x",
    platform: "x",
    account_id: "northstar-x",
    account_username: "northstar_studio",
    account_avatar_url: "/marketing-fixtures/avatar-northstar.svg",
    instance_url: "",
    is_active: true,
    thread_replies_supported: true,
  },
  {
    id: "account-mastodon",
    slug: "northstar-mastodon",
    platform: "mastodon",
    account_id: "northstar-mastodon",
    account_username: "northstar",
    account_avatar_url: "/marketing-fixtures/avatar-northstar.svg",
    instance_url: "https://mastodon.social",
    is_active: true,
    thread_replies_supported: true,
  },
  {
    id: "account-linkedin",
    slug: "northstar-linkedin",
    platform: "linkedin",
    account_id: "northstar-linkedin",
    account_username: "northstar-studio",
    account_avatar_url: "/marketing-fixtures/avatar-northstar.svg",
    instance_url: "",
    is_active: true,
    thread_replies_supported: true,
  },
];

function connectionReadiness(state: string, connectable: boolean, blocker?: string) {
  return {
    state,
    executable: connectable,
    connectable,
    publishable: false,
    advertisable: false,
    facts: {
      configuration: state === "needs_configuration" ? "missing" : "configured",
      local_test: "unknown",
      live_certification: "unknown",
      approval: "unknown",
      authorization: "unknown",
      control: "enabled",
      policy: "allowed",
    },
    blockers: blocker ? [{ code: blocker }] : [],
  };
}

const providerFixtures = [
  {
    platform: "x",
    display_name: "X",
    auth_mode: "oauth",
    configured: true,
    status: "available",
    readiness: connectionReadiness("healthy", true),
    description: "Connect an X account.",
  },
  {
    platform: "mastodon",
    display_name: "Mastodon",
    auth_mode: "oauth_oob",
    configured: true,
    status: "available",
    readiness: connectionReadiness("healthy", true),
    description: "Connect any public Mastodon instance.",
  },
  {
    platform: "bluesky",
    display_name: "Bluesky",
    auth_mode: "app_password",
    configured: true,
    status: "available",
    readiness: connectionReadiness("healthy", true),
    description: "Connect with an app password.",
  },
  {
    platform: "linkedin",
    display_name: "LinkedIn",
    auth_mode: "oauth",
    configured: true,
    status: "available",
    readiness: connectionReadiness("healthy", true),
    description: "Connect a LinkedIn profile.",
  },
  {
    platform: "threads",
    display_name: "Threads",
    auth_mode: "oauth",
    configured: true,
    status: "available",
    readiness: connectionReadiness("healthy", true),
    description: "Connect a Threads profile.",
  },
  {
    platform: "facebook",
    display_name: "Facebook Pages",
    auth_mode: "oauth",
    configured: false,
    status: "needs_configuration",
    readiness: connectionReadiness("needs_configuration", false, "missing_configuration"),
    description: "Requires a Meta provider app.",
  },
  {
    platform: "instagram",
    display_name: "Instagram Business",
    auth_mode: "oauth",
    configured: false,
    status: "needs_configuration",
    readiness: connectionReadiness("needs_configuration", false, "missing_configuration"),
    description: "Requires a Meta provider app.",
  },
  {
    platform: "tiktok",
    display_name: "TikTok",
    auth_mode: "oauth",
    configured: false,
    status: "needs_configuration",
    readiness: connectionReadiness("needs_configuration", false, "missing_configuration"),
    description: "Requires a reviewed TikTok provider app.",
  },
  {
    platform: "youtube",
    display_name: "YouTube",
    auth_mode: "oauth",
    configured: false,
    status: "needs_configuration",
    readiness: connectionReadiness("needs_configuration", false, "missing_configuration"),
    description: "Requires a Google OAuth provider app.",
  },
];

const mediaFixtures = [
  {
    id: "media-launch",
    filename: "launch-card.png",
    artwork: "launch",
    width: 1600,
    height: 900,
    size: 248_300,
    favorite: true,
    usage: 3,
    canDelete: false,
  },
  {
    id: "media-workflow",
    filename: "publishing-workflow.png",
    artwork: "workflow",
    width: 1200,
    height: 1200,
    size: 189_440,
    favorite: false,
    usage: 1,
    canDelete: false,
  },
  {
    id: "media-release",
    filename: "release-notes.png",
    artwork: "release",
    width: 1080,
    height: 1350,
    size: 312_080,
    favorite: true,
    usage: 0,
    canDelete: true,
  },
  {
    id: "media-calendar",
    filename: "content-calendar.png",
    artwork: "calendar",
    width: 1600,
    height: 1000,
    size: 276_900,
    favorite: false,
    usage: 2,
    canDelete: false,
  },
  {
    id: "media-library",
    filename: "media-library.png",
    artwork: "library",
    width: 1400,
    height: 1050,
    size: 221_640,
    favorite: false,
    usage: 0,
    canDelete: true,
  },
];

const artwork = {
  "avatar-northstar": `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
      <defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#f97316"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
      <rect width="160" height="160" rx="80" fill="url(#g)"/>
      <path d="M80 31 92 67l38 1-30 22 11 37-31-21-31 21 11-37-30-22 38-1Z" fill="#fff7ed"/>
    </svg>`,
  launch: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">
      <defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#261f1b"/><stop offset=".55" stop-color="#9a3412"/><stop offset="1" stop-color="#fb923c"/></linearGradient></defs>
      <rect width="1600" height="900" fill="url(#g)"/><circle cx="1310" cy="180" r="220" fill="#fff7ed" opacity=".16"/>
      <path d="M180 735c250-390 500-390 750 0" fill="none" stroke="#fed7aa" stroke-width="54" stroke-linecap="round"/>
      <text x="180" y="220" fill="#fff7ed" font-family="system-ui,sans-serif" font-size="88" font-weight="700">Launch week</text>
      <text x="180" y="315" fill="#ffedd5" font-family="system-ui,sans-serif" font-size="42">One plan. Every destination.</text>
    </svg>`,
  workflow: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">
      <rect width="1200" height="1200" fill="#f3efe8"/><g fill="none" stroke="#292524" stroke-width="18"><path d="M215 330h770M215 600h770M215 870h770"/></g>
      <g fill="#ea580c"><circle cx="300" cy="330" r="68"/><circle cx="600" cy="600" r="68"/><circle cx="900" cy="870" r="68"/></g>
      <text x="160" y="1080" fill="#292524" font-family="system-ui,sans-serif" font-size="64" font-weight="700">Draft · Adapt · Schedule</text>
    </svg>`,
  release: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350">
      <rect width="1080" height="1350" fill="#1c1917"/><rect x="120" y="145" width="840" height="1060" rx="60" fill="#292524" stroke="#57534e" stroke-width="8"/>
      <rect x="210" y="345" width="480" height="28" rx="14" fill="#fb923c"/><rect x="210" y="470" width="660" height="24" rx="12" fill="#78716c"/><rect x="210" y="550" width="570" height="24" rx="12" fill="#78716c"/>
      <rect x="210" y="810" width="260" height="110" rx="55" fill="#f97316"/><text x="210" y="275" fill="#fafaf9" font-family="system-ui,sans-serif" font-size="54" font-weight="700">Release notes</text>
    </svg>`,
  calendar: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000">
      <rect width="1600" height="1000" fill="#172554"/><g fill="#dbeafe" opacity=".96"><rect x="170" y="120" width="1260" height="760" rx="48"/></g>
      <g fill="#bfdbfe"><rect x="260" y="280" width="250" height="150" rx="24"/><rect x="550" y="280" width="250" height="150" rx="24"/><rect x="840" y="280" width="500" height="150" rx="24"/><rect x="260" y="475" width="450" height="245" rx="24"/><rect x="750" y="475" width="590" height="245" rx="24"/></g>
      <circle cx="1250" cy="790" r="62" fill="#f97316"/><path d="m1221 790 21 21 39-46" fill="none" stroke="white" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  library: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 1050">
      <defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#134e4a"/><stop offset="1" stop-color="#5eead4"/></linearGradient></defs><rect width="1400" height="1050" fill="url(#g)"/>
      <g fill="#f0fdfa" opacity=".92"><rect x="165" y="110" width="485" height="365" rx="42"/><rect x="750" y="110" width="485" height="365" rx="42"/><rect x="165" y="570" width="485" height="365" rx="42"/><rect x="750" y="570" width="485" height="365" rx="42"/></g>
      <g fill="#0f766e"><circle cx="408" cy="293" r="86"/><path d="m820 405 105-115 80 75 78-100 90 140Z"/><rect x="270" y="680" width="275" height="34" rx="17"/><rect x="855" y="680" width="275" height="34" rx="17"/></g>
    </svg>`,
} as const;

test.describe("product screenshot capture", () => {
  test.skip(
    !captureEnabled,
    "Run bun run capture:product-screenshots to update canonical product images.",
  );

  test.use({
    viewport: captureViewport,
    deviceScaleFactor: 1,
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "UTC",
  });

  test("captures current product surfaces with synthetic data", async ({ page, request }) => {
    await mkdir(screenshotDirectory, { recursive: true });

    const auth = await registerUser(request, "studio@northstar.example");
    const workspace = await createWorkspace(request, auth.token, "Northstar Studio");
    const profile = await request.patch("/api/v1/auth/profile", {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: { display_name: "Northstar Team" },
    });
    expect(profile.ok()).toBeTruthy();

    await authenticatePage(page, auth.token);
    await page.addInitScript(() => {
      localStorage.setItem("mode-watcher-mode", "dark");
    });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.clock.setFixedTime(new Date(fixedNow));

    await page.route("**/marketing-fixtures/**", async (route) => {
      const key = new URL(route.request().url()).pathname
        .split("/")
        .at(-1)
        ?.replace(/\.svg$/, "");
      const body = key ? artwork[key as keyof typeof artwork] : undefined;
      if (!body) {
        await route.abort();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        headers: { "cache-control": "public, max-age=31536000, immutable" },
        body,
      });
    });
    await page.route("**/media/media-*", async (route) => {
      const mediaID = new URL(route.request().url()).pathname.split("/").at(-1);
      const item = mediaFixtures.find((candidate) => candidate.id === mediaID);
      const body = item ? artwork[item.artwork as keyof typeof artwork] : undefined;
      if (!body) {
        await route.abort();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        headers: { "cache-control": "public, max-age=31536000, immutable" },
        body,
      });
    });

    await page.route("**/api/v1/accounts?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: connectedAccounts,
      });
    });
    await page.route("**/api/v1/accounts/providers", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: providerFixtures,
      });
    });
    await page.route("**/api/v1/provider-readiness**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          providers: connectedAccounts.map((account) => ({
            provider: account.platform,
            configured_app_state: "ready",
            connected_accounts: 1,
            blocking_issues: [],
            next_actions: [],
          })),
        },
      });
    });
    await page.route("**/api/v1/capabilities/resolve", async (route) => {
      const body = route.request().postDataJSON() as {
        account_ids?: string[];
        intent?: string;
      };
      const accounts = (body.account_ids ?? [])
        .map((accountID) => connectedAccounts.find((account) => account.id === accountID))
        .filter((account): account is (typeof connectedAccounts)[number] => Boolean(account))
        .map((account) => ({
          account_id: account.id,
          active_constraints: {},
          capability_revision: "product-screenshot-v1",
          compatible: true,
          intents: ["post", "thread"],
          issues: [],
          label:
            providerFixtures.find((provider) => provider.platform === account.platform)
              ?.display_name ?? account.platform,
          media: {
            allowed_mimes: ["image/jpeg", "image/png", "video/mp4"],
            max_count: 4,
            min_count: 0,
            requires_https_fetchable: false,
            requires_public_url: false,
          },
          media_shapes: ["landscape", "portrait", "square"],
          native_scheduling: false,
          openpost_queued: true,
          output_profile: account.platform,
          profile: account.platform,
          provider: account.platform,
          requires_app_review: false,
          requires_public_media: false,
          immediate_readiness: { state: "healthy", publishable: true },
          scheduled_readiness: { state: "healthy", publishable: true },
          setting_groups: [],
          text_limit: account.platform === "x" ? 280 : 3_000,
        }));
      await route.fulfill({
        contentType: "application/json",
        json: { accounts },
      });
    });
    await page.route("**/api/v1/media?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          total: mediaFixtures.length,
          limit: 40,
          offset: 0,
          media: mediaFixtures.map((item, index) => ({
            id: item.id,
            workspace_id: workspace.id,
            mime_type: "image/png",
            size: item.size,
            original_filename: item.filename,
            width: item.width,
            height: item.height,
            alt_text: `${item.filename.replace(/\.png$/, "")} marketing artwork`,
            is_favorite: item.favorite,
            created_at: new Date(Date.parse(fixedNow) - index * 86_400_000).toISOString(),
            url: `/marketing-fixtures/${item.artwork}.svg`,
            thumbnail_url: `/marketing-fixtures/${item.artwork}.svg`,
            usage_count: item.usage,
            can_delete: item.canDelete,
            processing_status: "ready",
            processing_progress: 100,
            analysis_status: "complete",
            duration_ms: 0,
            frame_rate: 0,
            source: "upload",
            asset_kind: "image",
            tags: [],
          })),
        },
      });
    });
    await page.route(`**/api/v1/workspaces/${workspace.id}/setup`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          activated: true,
          visible: false,
          completed_steps: 4,
          total_steps: 4,
          steps: [
            { id: "workspace", completed: true },
            { id: "destination", completed: true },
            { id: "composition", completed: true },
            { id: "publication", completed: true },
          ],
        },
      });
    });
    let publicationRevision = 0;
    let publicationState: Record<string, unknown> = {};
    await page.route("**/api/v1/publications", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      publicationRevision += 1;
      publicationState = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        contentType: "application/json",
        json: {
          ...publicationState,
          id: "screenshot-publication",
          workspace_id: workspace.id,
          revision: publicationRevision,
          status: "draft",
          renditions: publicationState.renditions ?? [],
        },
      });
    });
    await page.route("**/api/v1/publications/screenshot-publication", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      publicationRevision += 1;
      publicationState = {
        ...publicationState,
        ...(route.request().postDataJSON() as Record<string, unknown>),
      };
      await route.fulfill({
        contentType: "application/json",
        json: {
          ...publicationState,
          id: "screenshot-publication",
          workspace_id: workspace.id,
          revision: publicationRevision,
          status: "draft",
          renditions: publicationState.renditions ?? [],
        },
      });
    });

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/");
    await expect(page.getByTestId("compose-shell")).toBeVisible();
    await expect(page.getByTestId("composer-account-loading")).toHaveCount(0);
    await expect(
      page.getByTestId("composer-account-control").getByTestId("composer-account-icon"),
    ).toHaveCount(3);
    await page
      .locator("#post-textarea-0")
      .fill(
        "A clearer way to plan the next release: draft once, adapt each destination, and keep every scheduled post visible from one workspace.",
      );
    const composer = page.getByTestId("text-thread-composer-content");
    await composer.getByRole("button", { name: "Add media" }).click();
    const mediaPicker = page.getByRole("dialog");
    await mediaPicker.getByRole("tab", { name: "Library" }).click();
    await mediaPicker.getByRole("button", { name: "Select launch-card.png" }).click();
    await mediaPicker.getByRole("button", { name: "Add media", exact: true }).click();
    await expect(composer.getByRole("button", { name: "Remove media" })).toBeVisible();
    await page.locator("#composer-destination-account-linkedin").click();
    await expect(page.getByRole("button", { name: "Preview" })).toBeVisible();
    await capture(page, "main-dark.png", [
      page.getByTestId("desktop-composer-controls"),
      composer.getByRole("button", { name: "Remove media" }),
    ]);

    await page.goto("/accounts");
    await expect(page.getByRole("heading", { name: "Connected channels" })).toBeVisible();
    await expect(page.getByText("@northstar_studio")).toBeVisible();
    await expect(page.getByTestId("provider-card-bluesky")).toBeVisible();
    await capture(page, "accounts-dark.png", [
      page.getByRole("heading", { name: "Connected channels" }),
      page.getByTestId("provider-card-youtube"),
    ]);

    await page.goto("/media");
    await expect(page.getByRole("heading", { name: "Media", level: 1 })).toBeVisible();
    await expect(page.getByText("launch-card.png")).toBeVisible();
    await page.waitForFunction(() =>
      Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0),
    );
    await capture(page, "media-dark.png", [
      page.getByRole("heading", { name: "Media", level: 1 }),
      page.getByText("media-library.png"),
    ]);

    await page.goto("/settings?tab=general");
    await expect(page.getByRole("heading", { name: "General", level: 1 })).toBeVisible();
    await expect(page.locator('[data-settings-tab="general"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
    await capture(page, "settings-dark.png", [
      page.getByRole("heading", { name: "General", level: 1 }),
      page.getByRole("button", { name: "Save changes" }),
    ]);

    expect(pageErrors).toEqual([]);
  });
});

async function capture(page: Page, filename: string, landmarks: Locator[]) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForFunction(() =>
    Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0),
  );
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(
    page.getByRole("region", { name: /Notifications/u }).getByRole("listitem"),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      })),
    )
    .toEqual({ documentWidth: captureViewport.width, viewportWidth: captureViewport.width });
  for (const landmark of landmarks) await expect(landmark).toBeInViewport();
  await page.screenshot({
    path: join(screenshotDirectory, filename),
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    scale: "css",
  });
}
