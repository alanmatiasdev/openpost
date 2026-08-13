import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, password, registerUser } from "./helpers";

const accounts = [
  {
    id: "connected-destination",
    slug: "connected-destination",
    platform: "threads",
    account_id: "provider-connected",
    account_username: "new_destination",
    account_avatar_url: "",
    instance_url: "",
    is_active: true,
    thread_replies_supported: false,
  },
  {
    id: "existing-destination",
    slug: "existing-destination",
    platform: "bluesky",
    account_id: "provider-existing",
    account_username: "existing_destination",
    account_avatar_url: "",
    instance_url: "",
    is_active: true,
    thread_replies_supported: false,
  },
];

test.describe("OAuth composer handoff", () => {
  for (const viewport of [
    { name: "desktop", width: 1280, height: 800 },
    { name: "phone", width: 390, height: 844 },
  ]) {
    test(`selects only the connected destination on ${viewport.name} and after refresh`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize(viewport);
      const unique = `${viewport.name}-${Date.now().toString(36)}`;
      const auth = await registerUser(request, `oauth-handoff-${unique}@example.com`);
      const workspace = await createWorkspace(request, auth.token, `OAuth ${unique}`);
      await authenticatePage(page, auth.token);
      const resolvedAccountIDs: string[][] = [];

      await page.route("**/api/v1/accounts?**", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        await route.fulfill({
          contentType: "application/json",
          json: accounts,
        });
      });
      await page.route("**/api/v1/capabilities/resolve", async (route) => {
        const payload = route.request().postDataJSON() as {
          account_ids: string[];
        };
        resolvedAccountIDs.push(payload.account_ids);
        await route.fulfill({
          contentType: "application/json",
          json: {
            accounts: payload.account_ids.map((accountID) => ({
              account_id: accountID,
              provider: "threads",
              profile: "short_text",
              output_profile: "threads.post",
              label: "Threads post",
              text_limit: 500,
              media: { min_count: 0, max_count: 1, allowed_mimes: [] },
              intents: ["post"],
              media_shapes: ["text"],
              settings: [],
              setting_groups: [],
              compatible: true,
              issues: [],
              active_constraints: {},
              capability_revision: "test-v1",
              dynamic_options: {},
            })),
          },
        });
      });

      const handoff = `/?workspace_id=${workspace.id}&account_ids=connected-destination`;
      await page.goto(handoff);

      await expect(page.getByText(/Composer ready/)).toBeVisible();
      expect(resolvedAccountIDs.every((ids) => !ids.includes("existing-destination"))).toBe(true);
      await page.getByTestId("composer-account-control").click();
      const rows = page.getByTestId("composer-account-row");
      await expect(rows.filter({ hasText: "new_destination" }).getByRole("checkbox")).toBeChecked();
      await expect(
        rows.filter({ hasText: "existing_destination" }).getByRole("checkbox"),
      ).not.toBeChecked();
      await page.keyboard.press("Escape");

      await page.reload();
      await expect(page.getByText(/Composer ready/)).toBeVisible();
      await page.getByTestId("composer-account-control").click();
      await expect(rows.filter({ hasText: "new_destination" }).getByRole("checkbox")).toBeChecked();
      await expect(
        rows.filter({ hasText: "existing_destination" }).getByRole("checkbox"),
      ).not.toBeChecked();

      await page.context().clearCookies();
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.goto(`/login?redirect=${encodeURIComponent(handoff)}`);
      expect(new URL(page.url()).searchParams.get("redirect")).toBe(handoff);
      await page.getByLabel("Email", { exact: true }).fill(`oauth-handoff-${unique}@example.com`);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign In" }).click();
      await expect(page).toHaveURL(new RegExp(`${handoff.replace(/[?]/g, "\\?")}$`));
      await page.getByTestId("composer-account-control").click();
      await expect(rows.filter({ hasText: "new_destination" }).getByRole("checkbox")).toBeChecked();
    });
  }

  for (const viewport of [
    { name: "desktop", width: 1280, height: 800 },
    { name: "phone", width: 390, height: 844 },
  ]) {
    test(`returns cancellation and failure to actionable account management on ${viewport.name}`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize(viewport);
      const unique = `${viewport.name}-${Date.now().toString(36)}`;
      const auth = await registerUser(request, `oauth-recovery-${unique}@example.com`);
      const workspace = await createWorkspace(request, auth.token, `OAuth recovery ${unique}`);
      const previousWorkspace = await createWorkspace(
        request,
        auth.token,
        `Previous OAuth recovery ${unique}`,
      );
      await authenticatePage(page, auth.token);
      await page.goto("/");
      await page.evaluate((storedWorkspace) => {
        localStorage.setItem("openpost_current_workspace", JSON.stringify(storedWorkspace));
      }, previousWorkspace);

      await page.goto(`/settings?tab=accounts&oauth_status=cancelled&workspace_id=${workspace.id}`);
      await expect(
        page.getByText("Connection cancelled. Choose a destination to try again."),
      ).toBeVisible();
      await expect(page.getByText("Connect a destination", { exact: true }).first()).toBeVisible();
      await expect
        .poll(async () =>
          page.evaluate(
            () => JSON.parse(localStorage.getItem("openpost_current_workspace") ?? "{}").id,
          ),
        )
        .toBe(workspace.id);
      await expect(page).not.toHaveURL(/oauth_status|workspace_id/);

      await page.reload();
      await expect(page.getByText("Connect a destination", { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/Connection cancelled/)).not.toBeVisible();

      await page.goto(`/settings?tab=accounts&oauth_status=failed&workspace_id=${workspace.id}`);
      await expect(page.getByText(/OpenPost could not connect that destination/)).toBeVisible();
      await expect(page.getByText("Connect a destination", { exact: true }).first()).toBeVisible();
      await expect(page).not.toHaveURL(/oauth_status|workspace_id/);
    });
  }
});
