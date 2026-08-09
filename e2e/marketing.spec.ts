import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { parseChangelog } from "../packages/changelog/src/index.js";

test("marketing index links to the app and documentation @desktop", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveTitle(
    "OpenPost - Social publishing workspace for solo founders",
  );
  await expect(
    page.getByRole("heading", {
      name: "Write and schedule social posts in one workspace.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "OpenPost helps solo founders write, adapt, preview, and schedule each post without reopening every network.",
      { exact: true },
    ),
  ).toBeVisible();
  const hero = page.locator("section.hero");
  await expect(
    hero.getByRole("link", { name: "Start your 14-day trial" }),
  ).toHaveAttribute(
    "href",
    "https://app.openpost.social/register?plan=founder",
  );
  const resultPreviews = page.getByRole("group", {
    name: "Social publishing result previews",
  });
  await expect(resultPreviews).toBeVisible();
  await expect(page.getByText("Illustrative campaign results")).toHaveCount(0);
  await expect(
    resultPreviews.getByRole("button", { name: "Show Audience growth" }),
  ).toBeVisible();
  await expect(page.getByLabel("Companies using OpenPost")).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "See OpenPost in four minutes.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Play the OpenPost product demo" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Play the OpenPost product demo" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "OpenPost product demo" }),
  ).toBeVisible();
  const videoDialog = page.getByRole("dialog", {
    name: "OpenPost product demo",
  });
  const dialogBox = await videoDialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.width / dialogBox!.height).toBeCloseTo(16 / 9, 1);
  expect(dialogBox!.width).toBeLessThanOrEqual(
    (page.viewportSize()?.width ?? dialogBox!.width) - 16,
  );
  expect(dialogBox!.height).toBeLessThanOrEqual(
    (page.viewportSize()?.height ?? dialogBox!.height) - 16,
  );
  await expect(page.getByTitle("OpenPost product demo")).toBeVisible();
  await page.getByRole("button", { name: "Close product demo" }).click();
  await expect(page.getByTitle("OpenPost product demo")).toHaveCount(0);
  await expect(page.getByText("One working loop")).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "Everything you need to publish.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Adapt every post.",
    }),
  ).toBeVisible();
  await expect(page.getByAltText("OpenPost social accounts page")).toHaveCount(
    0,
  );
  await expect(
    page.getByAltText("OpenPost connected social accounts page"),
  ).toHaveAttribute("src", "/assets/screenshots/accounts-dark.png");
  await expect(
    page.getByRole("heading", {
      name: "Built around real publishing work.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Illustrative creator stories")).toHaveCount(0);
  await expect(page.getByText("Example workflows using OpenPost")).toHaveCount(
    0,
  );
  const creatorMosaic = page.getByRole("region", {
    name: "Built around real publishing work.",
  });
  await expect(
    creatorMosaic.getByRole("button", { name: "Show more stories" }),
  ).toBeVisible();
  await creatorMosaic
    .getByRole("button", { name: "Show more stories" })
    .click();
  await expect(
    creatorMosaic.getByRole("heading", { name: "Developer" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "See what consistency can build." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Self-host", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "User docs" }).first(),
  ).toHaveAttribute("href", "https://docs.openpost.social/usage/");
  await expect(
    page.getByRole("link", { name: "Self-hosting" }).first(),
  ).toHaveAttribute("href", "https://docs.openpost.social/self-hosting/");
  await expect(
    page.getByRole("link", { name: "Developer docs" }).first(),
  ).toHaveAttribute("href", "https://docs.openpost.social/development/");
  await expect(
    page.getByRole("link", { name: "GitHub source" }),
  ).toHaveAttribute("href", "https://github.com/rodrgds/openpost");
  await expect(
    page.getByRole("link", { name: "Discord", exact: true }).last(),
  ).toHaveAttribute("href", "https://discord.gg/u2QwukmY4W");
});

test("pricing makes every plan selectable for monthly and annual billing", async ({
  page,
}) => {
  const planCases = [
    { id: "starter", name: "Starter", monthly: "$15", annual: "$150" },
    { id: "founder", name: "Founder", monthly: "$25", annual: "$250" },
    { id: "pro", name: "Pro", monthly: "$49", annual: "$490" },
    { id: "team", name: "Team", monthly: "$99", annual: "$990" },
    { id: "agency", name: "Agency", monthly: "$199", annual: "$1,990" },
  ] as const;

  await page.goto("/pricing");

  await expect(page.getByRole("article")).toHaveCount(5);
  for (const plan of planCases) {
    const card = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: plan.name }) });
    await expect(card.locator(".animated-price")).toHaveAttribute(
      "aria-label",
      plan.monthly,
    );
    await expect(
      card.getByRole("link", { name: `Start ${plan.name}` }),
    ).toHaveAttribute(
      "href",
      `https://app.openpost.social/register?plan=${plan.id}&billing_period=monthly`,
    );
  }

  await page.getByRole("button", { name: /^Yearly/ }).click();
  for (const plan of planCases) {
    const card = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: plan.name }) });
    await expect(card).toContainText(`Billed ${plan.annual} yearly`);
    await expect(
      card.getByRole("link", { name: `Start ${plan.name}` }),
    ).toHaveAttribute(
      "href",
      `https://app.openpost.social/register?plan=${plan.id}&billing_period=annual`,
    );
  }

  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    const comparison = page.locator(".desktop-limits");
    for (const plan of planCases) {
      await expect(
        comparison.getByRole("columnheader", { name: plan.name }),
      ).toContainText(`${plan.annual}/year`);
    }
  } else {
    const comparison = page.locator(".mobile-limits");
    for (const plan of planCases) {
      await expect(
        comparison.locator(`[data-plan-id="${plan.id}"]`),
      ).toContainText(`${plan.annual}/year`);
    }
  }

  await page.setViewportSize({ width: 320, height: 720 });
  await expect(page.getByRole("article")).toHaveCount(5);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("security page states AI tool access accurately @desktop", async ({
  page,
}) => {
  await page.goto("/security");

  await expect(
    page.getByRole("heading", {
      name: "Keep social credentials inside the publishing system.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "mcp:full can make changes",
    }),
  ).toBeVisible();
  const humanReview = page
    .getByRole("heading", { name: "You choose when to review" })
    .locator("..");
  await expect(humanReview).toContainText(
    "OpenPost does not add a separate approval step",
  );
});

test("marketing index has no horizontal overflow", async ({ page }) => {
  await page.goto("/");

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("landing stays responsive and theme-aware", async ({ page }) => {
  await page.goto("/");

  const viewportWidth = page.viewportSize()?.width ?? 1280;
  await expect(page.locator("[data-floating-mark]")).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Write and schedule social posts in one workspace.",
    }),
  ).toBeVisible();
  await expect(
    page
      .locator("section.hero")
      .getByRole("link", { name: "Start your 14-day trial" }),
  ).toHaveAttribute(
    "href",
    "https://app.openpost.social/register?plan=founder",
  );
  await expect(
    page.locator("section.hero").getByText(
      "Start with a 14-day free trial. A card is required, and you can cancel before the first charge.",
    ),
  ).toBeVisible();
  await expect(page.locator(".hero-title")).toHaveCSS(
    "color",
    "oklch(0.2 0.01 50)",
  );

  if (viewportWidth >= 1024) {
    await page.getByRole("button", { name: "Use dark theme" }).click();
  } else {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
  }
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator(".hero-title")).toHaveCSS(
    "color",
    "rgb(255, 255, 255)",
  );

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("hero previews provide persistent, quiet motion controls", async ({
  page,
}) => {
  await page.goto("/");

  const carousel = page.getByRole("group", {
    name: "Social publishing result previews",
  });
  const tiktok = carousel.getByRole("button", { name: "Show Video reach" });
  const instagram = carousel.getByRole("button", {
    name: "Show Content results",
  });
  const x = carousel.getByRole("button", { name: "Show Audience growth" });
  const announcement = carousel.locator('[aria-live="polite"]');

  await expect(tiktok).toHaveAttribute("data-active", "true");
  await expect(announcement).toHaveText("");

  await carousel.getByRole("button", { name: "Pause previews" }).click();
  await expect(
    carousel.getByRole("button", { name: "Play previews" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("openpost:marketing-motion")),
    )
    .toBe("paused");
  await page.waitForTimeout(5_200);
  await expect(tiktok).toHaveAttribute("data-active", "true");

  await page.reload();
  await expect(
    carousel.getByRole("button", { name: "Play previews" }),
  ).toBeVisible();
  await carousel.getByRole("button", { name: "Play previews" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    carousel.getByRole("button", { name: "Pause previews" }),
  ).toBeVisible();
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  await page.waitForTimeout(5_200);
  await expect(instagram).toHaveAttribute("data-active", "true");
  await expect(announcement).toHaveText("");

  await x.focus();
  await page.keyboard.press("Enter");
  await expect(x).toHaveAttribute("data-active", "true");
  await expect(announcement).toHaveText("Showing Audience growth");
  await page.waitForTimeout(5_200);
  await expect(x).toHaveAttribute("data-active", "true");

  await page.evaluate(() =>
    sessionStorage.setItem("openpost:marketing-motion", "playing"),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const reducedMotionControl = carousel.getByRole("button", {
    name: "Automatic rotation off",
  });
  await expect(reducedMotionControl).toBeDisabled();
  await expect(tiktok).toHaveAttribute("data-active", "true");
  await page.waitForTimeout(5_200);
  await expect(tiktok).toHaveAttribute("data-active", "true");
});

test("hero and footer actions remain usable at 320 pixels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");

  const trialLink = page
    .locator("section.hero")
    .getByRole("link", { name: "Start your 14-day trial" });
  await expect(trialLink).toBeVisible();
  await trialLink.focus();
  await expect(trialLink).toBeFocused();

  const footerGuides = page
    .locator("footer")
    .getByLabel("Platform publishing guides")
    .getByRole("link");
  expect(await footerGuides.count()).toBeGreaterThan(0);
  for (let index = 0; index < (await footerGuides.count()); index += 1) {
    const box = await footerGuides.nth(index).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await footerGuides.first().focus();
  await expect(footerGuides.first()).toBeFocused();

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("marketing raised buttons synthesize tactile feedback @desktop", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const parameter = () => ({
      value: 0,
      setValueAtTime() {},
      exponentialRampToValueAtTime() {},
    });
    const audioNode = () => ({
      connect() {
        return this;
      },
      disconnect() {},
      start() {
        (
          window as Window & { __openpostSoundStarts?: number }
        ).__openpostSoundStarts =
          ((window as Window & { __openpostSoundStarts?: number })
            .__openpostSoundStarts ?? 0) + 1;
      },
      stop() {},
    });

    class TestAudioContext {
      currentTime = 0;
      destination = audioNode();
      sampleRate = 44_100;
      state = "running";

      createGain() {
        return { ...audioNode(), gain: parameter() };
      }
      createBuffer(_channels: number, length: number) {
        return { getChannelData: () => new Float32Array(length) };
      }
      createBufferSource() {
        return { ...audioNode(), buffer: null };
      }
      createBiquadFilter() {
        return {
          ...audioNode(),
          type: "bandpass",
          frequency: parameter(),
          Q: parameter(),
        };
      }
      resume() {
        return Promise.resolve();
      }
    }

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: TestAudioContext,
    });
    Object.defineProperty(navigator, "userActivation", {
      configurable: true,
      value: { hasBeenActive: true },
    });
  });

  await page.goto("/");
  const trialLink = page
    .locator("section.hero")
    .getByRole("link", { name: "Start your 14-day trial" });
  await expect(trialLink).toHaveAttribute("data-cuelume-press", "press");
  await expect(trialLink).toHaveAttribute("data-cuelume-release", "release");
  await trialLink.dispatchEvent("pointerdown", { pointerType: "mouse" });
  await trialLink.dispatchEvent("pointerup", { pointerType: "mouse" });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __openpostSoundStarts?: number })
            .__openpostSoundStarts ?? 0,
      ),
    )
    .toBeGreaterThan(1);
});

test("marketing navigation uses the shared responsive menu patterns", async ({
  page,
}) => {
  await page.goto("/");

  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    const navigation = page.getByRole("navigation", {
      name: "Primary navigation",
    });
    await expect(navigation).toHaveAttribute("data-slot", "navigation-menu");
    await navigation.getByRole("button", { name: "Resources" }).click();
    await expect(
      navigation.getByRole("link", { name: "Changelog", exact: true }),
    ).toHaveAttribute("href", "/changelog");
    await expect(
      navigation.getByRole("link", {
        name: "Discord community",
        exact: true,
      }),
    ).toHaveAttribute("href", "https://discord.gg/u2QwukmY4W");
    await page.keyboard.press("Escape");
    return;
  }

  await page.getByRole("button", { name: "Open navigation" }).click();
  const navigation = page.getByRole("navigation", {
    name: "Mobile navigation",
  });
  await expect(navigation).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Changelog", exact: true }),
  ).toHaveAttribute("href", "/changelog");
  await expect(
    navigation.getByRole("link", {
      name: "Discord community",
      exact: true,
    }),
  ).toHaveAttribute("href", "https://discord.gg/u2QwukmY4W");
});

test("marketing SEO routes expose the current public index @desktop", async ({
  request,
}) => {
  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBeTruthy();
  const robotsText = await robots.text();
  expect(robotsText).toContain("Sitemap: https://openpost.social/sitemap.xml");

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBeTruthy();
  const xml = await sitemap.text();
  expect(xml).toContain("<loc>https://openpost.social/</loc>");
  expect(xml).toContain("<loc>https://openpost.social/platforms</loc>");
  expect(xml).toContain("<loc>https://openpost.social/platforms/x</loc>");
  expect(xml).toContain("<loc>https://openpost.social/platforms/discord</loc>");
  expect(xml).toContain("<loc>https://openpost.social/compare</loc>");
  expect(xml).toContain("<loc>https://openpost.social/compare/buffer</loc>");
  expect(xml).toContain("<loc>https://openpost.social/tools</loc>");
  expect(xml).toContain(
    "<loc>https://openpost.social/tools/multi-platform-character-counter</loc>",
  );
  expect(xml).toContain(
    "<loc>https://openpost.social/tools/post-preview-generator</loc>",
  );
  expect(xml).toContain(
    "<loc>https://openpost.social/tools/thread-splitter</loc>",
  );
  expect(xml).toContain(
    "<loc>https://openpost.social/tools/fediverse-handle-checker</loc>",
  );
  expect(xml).toContain(
    "<loc>https://openpost.social/tools/linkedin-text-formatter</loc>",
  );
  expect(xml).toContain(
    "<loc>https://openpost.social/tools/best-time-to-post-calculator</loc>",
  );
  expect(xml).toContain("<loc>https://openpost.social/security</loc>");
  expect(xml).toContain("<loc>https://openpost.social/trust</loc>");
  expect(xml).toContain("<loc>https://openpost.social/privacy</loc>");
  expect(xml).toContain("<loc>https://openpost.social/terms</loc>");
  expect(xml).toContain("<loc>https://openpost.social/refunds</loc>");
  expect(xml).not.toContain("<loc>https://openpost.social/blog</loc>");
  expect(xml).not.toContain("<loc>https://openpost.social/tips/");

  const publicPaths = [
    ...xml.matchAll(/<loc>(https:\/\/openpost\.social[^<]+)<\/loc>/g),
  ].map(([, url]) => new URL(url).pathname);
  expect(publicPaths.length).toBeGreaterThan(20);
  for (const path of publicPaths) {
    const response = await request.get(path);
    expect(response.ok(), `${path} should be publicly reachable`).toBeTruthy();
  }
});

test("legal and trust pages expose current managed-service facts @desktop", async ({
  page,
}) => {
  const pages = [
    { path: "/terms", heading: "Terms of Service", version: "2026-08-05" },
    { path: "/privacy", heading: "Privacy Policy", version: "2026-08-09" },
    { path: "/refunds", heading: "Refund Policy", version: "2026-08-05" },
  ];

  for (const legalPage of pages) {
    await page.goto(legalPage.path);
    await expect(
      page.getByRole("heading", { name: legalPage.heading, level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(/Paddle/).first()).toBeVisible();
    await expect(
      page.getByText(`Policy version: ${legalPage.version}`),
    ).toBeVisible();
  }

  await page.goto("/privacy");
  await expect(
    page.getByText(/optionally record a camera track/),
  ).toBeVisible();
  await expect(
    page.locator("p").filter({
      hasText:
        "Local project data, recordings, sources, and exports are uploaded only",
    }),
  ).toBeVisible();
  await expect(
    page.locator("p").filter({
      hasText: "OpenPost does not add a separate application-level encryption",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Managed service trust register",
      exact: true,
    }),
  ).toHaveAttribute("href", "/trust");

  await page.goto("/trust");
  await expect(
    page.getByRole("heading", {
      name: "Where managed OpenPost data is stored and processed.",
      level: 1,
    }),
  ).toBeVisible();
  await expect(page.getByText("9 August 2026", { exact: true })).toBeVisible();
  await expect(
    page.getByText("9 November 2026", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Falkenstein, Germany (FSN1)").first(),
  ).toBeVisible();
  await expect(
    page.getByText(/Cloudflare automatic placement/).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Add Rabbit LLC (Purelymail)" }),
  ).toBeVisible();
  await expect(
    page.getByText(/open operator and legal review item/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Microsoft Azure" }),
  ).toBeVisible();
  await expect(page.getByText(/azure\/eu/)).toBeVisible();
  await expect(
    page.getByText(/There is no two-person approval control/),
  ).toBeVisible();
  await expect(
    page.getByText(/does not provide a complete command-level audit trail/),
  ).toBeVisible();
  await expect(page.getByText(/SOC 2|ISO 27001|GDPR certified/)).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.goto("/refunds");
  await expect(
    page
      .locator("p")
      .filter({ hasText: "OpenPost does not record a separate acceptance" }),
  ).toBeVisible();

  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Terms", exact: true }).last(),
  ).toHaveAttribute("href", "/terms");
  await expect(
    page.getByRole("link", { name: "Privacy", exact: true }).last(),
  ).toHaveAttribute("href", "/privacy");
  await expect(
    page.getByRole("link", { name: "Refunds", exact: true }).last(),
  ).toHaveAttribute("href", "/refunds");
  await expect(
    page.getByRole("link", { name: "Trust", exact: true }).last(),
  ).toHaveAttribute("href", "/trust");
});

test("free marketing tools produce useful output @desktop", async ({
  page,
}) => {
  await page.goto("/tools/multi-platform-character-counter");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Post text" }).fill("hello");
  await expect(
    page.getByRole("progressbar", { name: "X character use" }),
  ).toHaveAttribute("aria-valuenow", "5");
  await expect(
    page.getByRole("progressbar", { name: "Discord character use" }),
  ).toHaveAttribute("aria-valuenow", "5");

  await page.goto("/tools/post-preview-generator");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Platform", exact: true }).click();
  await page.getByRole("option", { name: "Mastodon", exact: true }).click();
  await expect(page.locator("select")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: /Account, links, polls, and media/,
    })
    .click();
  await page.getByLabel("Handle").fill("@alice@hachyderm.io");
  await expect(
    page.locator('[aria-label="Mastodon post preview"]'),
  ).toContainText("@alice@hachyderm.io");

  await page.goto("/tools/thread-splitter");
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("textbox", { name: "Text to split into a thread" })
    .fill("x".repeat(300));
  await page.getByRole("button", { name: "Social network" }).click();
  await page.getByRole("option", { name: /Bluesky/ }).click();
  await expect(page.getByRole("button", { name: "Copy part 2" })).toBeVisible();

  await page.goto("/tools/fediverse-handle-checker");
  await page.waitForLoadState("networkidle");
  await page
    .getByLabel("Fediverse or Bluesky handle")
    .fill("@alice@hachyderm.io");
  await expect(
    page.getByText("@alice@hachyderm.io", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Check live" })).toBeEnabled();

  await page.goto("/tools/linkedin-text-formatter");
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("textbox", { name: "LinkedIn post draft" })
    .fill("First sentence. Second sentence.");
  await page.getByRole("button", { name: "Paragraph length" }).click();
  await page.getByRole("option", { name: "One sentence" }).click();
  await page
    .getByRole("checkbox", { name: "Use the same bullet style" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Formatted LinkedIn post" }),
  ).toHaveValue(/First sentence/);

  await page.goto("/tools/best-time-to-post-calculator");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Posts per week").fill("2");
  await expect(
    page
      .getByRole("region", { name: "Your local schedule" })
      .getByRole("listitem"),
  ).toHaveCount(2);
});

test("public changelog is generated from the canonical release record @desktop", async ({
  page,
}) => {
  const canonicalSection = parseChangelog(
    readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"),
  ).find((section) => section.groups.some((group) => group.items.length > 0));
  const canonicalItem = canonicalSection?.groups.find(
    (group) => group.items.length > 0,
  )?.items[0];
  if (!canonicalItem) {
    throw new Error("The canonical changelog has no visible entries");
  }

  await page.goto("/changelog");

  await expect(
    page
      .getByRole("heading", {
        name: /^(?:Unreleased|v\d+\.\d+\.\d+)$/,
      })
      .first(),
  ).toBeVisible();
  await expect(page.getByText(canonicalItem, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Full changelog" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/rodrgds/openpost/blob/main/CHANGELOG.md",
  );
});
