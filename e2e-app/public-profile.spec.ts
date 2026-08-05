import { expect, test } from "@playwright/test";

function profileActivity() {
  const today = new Date();
  return Array.from({ length: 365 }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (364 - index));
    const count = index > 340 && index % 4 !== 0 ? (index % 5) + 1 : 0;
    return {
      date: date.toISOString().slice(0, 10),
      count,
      level: count === 0 ? 0 : Math.min(4, count),
    };
  });
}

test("public publishing profile stays readable at 320px", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.setViewportSize({ width: 320, height: 900 });
  await page.route("**/api/v1/public/profiles/rodrgds", (route) =>
    route.fulfill({
      json: {
        username: "rodrgds",
        display_name: "Rodrigo Dias",
        avatar_url: "",
        plan_id: "pro",
        joined_at: "2025-08-03T12:00:00Z",
        lifetime_posts: 327,
        peak_posts: 8,
        current_streak: 6,
        longest_streak: 32,
        active_days: 118,
        activity: profileActivity(),
        top_platforms: [
          { key: "x", name: "X", count: 180 },
          { key: "linkedin", name: "LinkedIn", count: 97 },
        ],
        top_workspaces: [
          { key: "openpost", name: "OpenPost", count: 210 },
          { key: "personal", name: "Personal", count: 117 },
        ],
      },
    }),
  );

  await page.goto("/u/rodrgds");

  await expect(
    page.getByRole("heading", { name: "Rodrigo Dias" }),
  ).toBeVisible();
  await expect(page.getByText("@rodrgds")).toBeVisible();
  await expect(page.getByText("Pro", { exact: true })).toBeVisible();
  await expect(page.getByText("327")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Publishing activity" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Most used platforms" }),
  ).toBeVisible();
  await expect(
    page.getByText("OpenPost", { exact: true }).last(),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  expect(consoleErrors).toEqual([]);
});

test("public publishing profile fits a desktop viewport", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.route("**/api/v1/public/profiles/rodrgds", (route) =>
    route.fulfill({
      json: {
        username: "rodrgds",
        display_name: "Rodrigo Dias",
        avatar_url: "",
        plan_id: "pro",
        joined_at: "2025-08-03T12:00:00Z",
        lifetime_posts: 18,
        peak_posts: 4,
        current_streak: 1,
        longest_streak: 1,
        active_days: 9,
        activity: profileActivity(),
        top_platforms: [
          { key: "bluesky", name: "Bluesky", count: 14 },
          { key: "linkedin", name: "LinkedIn", count: 14 },
          { key: "mastodon", name: "Mastodon", count: 14 },
          { key: "x", name: "X", count: 13 },
          { key: "threads", name: "Threads", count: 12 },
        ],
        top_workspaces: [{ key: "personal", name: "Personal", count: 18 }],
      },
    }),
  );

  await page.goto("/u/rodrgds");

  await expect(
    page.getByRole("heading", { name: "Rodrigo Dias" }),
  ).toBeVisible();
  await expect(page.getByText("Pro", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(900);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1600);
  const activityWidths = await page.evaluate(() => ({
    field:
      document
        .querySelector<HTMLElement>(".activity-field")
        ?.getBoundingClientRect().width ?? 0,
    scroll:
      document
        .querySelector<HTMLElement>(".activity-scroll")
        ?.getBoundingClientRect().width ?? 0,
  }));
  expect(activityWidths.field).toBeGreaterThanOrEqual(
    activityWidths.scroll - 1,
  );
  expect(consoleErrors).toEqual([]);
});
