import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("an incomplete owner sees server-derived setup guidance on home and Accounts after sign-in and refresh", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `setup-guide-${unique}@example.com`);
  await createWorkspace(request, auth.token, `Setup guide ${unique}`);

  await authenticatePage(page, auth.token);
  await page.goto("/");

  const homeGuide = page.getByTestId("workspace-setup-guide-home");
  const composerGuide = page.getByTestId("workspace-setup-guide-composer");
  await expect(homeGuide).toBeVisible();
  await expect(homeGuide).toContainText("1 of 4 complete");
  await expect(homeGuide).toContainText("Connect a destination");
  await expect(homeGuide).not.toContainText("Plan");
  await expect(homeGuide.getByRole("link", { name: "Resume checkout" })).toHaveCount(0);
  await expect(homeGuide.getByRole("link", { name: "Connect a destination" })).toHaveAttribute(
    "href",
    "/settings?tab=accounts",
  );
  await expect(composerGuide).toBeHidden();
  await page.reload();
  await expect(homeGuide).toBeVisible();
  await expect(homeGuide).toContainText("1 of 4 complete");
  await expect(composerGuide).toBeHidden();

  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(homeGuide).toContainText("1 of 4 complete");
  await page.goto("/settings?tab=accounts");
  const accountsGuide = page.getByTestId("workspace-setup-guide-accounts");
  await expect(accountsGuide).toBeVisible();
  await expect(accountsGuide).toContainText("Connect a destination");
  await expect(accountsGuide).not.toContainText("Plan");
  await expect(accountsGuide.getByRole("link", { name: "Resume checkout" })).toHaveCount(0);
  await expect(page.getByText("Step 2 of 3")).toHaveCount(0);

  await page.goto("/");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(homeGuide).toBeHidden();
  await expect(composerGuide).toBeVisible();
  await expect(composerGuide).toContainText("Connect a destination");
});
