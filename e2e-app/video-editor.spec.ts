import { expect, test, type Page } from "@playwright/test";

async function installLocalWorkspacePicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        const handle = await navigator.storage.getDirectory();
        const prototype = Object.getPrototypeOf(handle);
        if (!("queryPermission" in prototype)) {
          Object.defineProperty(prototype, "queryPermission", {
            configurable: true,
            value: async () => "granted",
          });
        }
        if (!("requestPermission" in prototype)) {
          Object.defineProperty(prototype, "requestPermission", {
            configurable: true,
            value: async () => "granted",
          });
        }
        return handle;
      },
    });
  });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        body: document.body.scrollWidth - window.innerWidth,
        document: document.documentElement.scrollWidth - window.innerWidth,
      })),
    )
    .toEqual({ body: 0, document: 0 });
}

test("Video Editor project shell stays usable at phone and desktop widths", async ({ page }) => {
  test.setTimeout(60_000);
  const consoleFailures: string[] = [];
  page.on("pageerror", (error) => consoleFailures.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleFailures.push(`${message.type()}: ${message.text()}`);
    }
  });
  await installLocalWorkspacePicker(page);
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Choose folder" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Responsive route proof");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+$/u);
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();

  for (const viewport of [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole("tab", { name: "Color" }).click();
    const colorDock = page.getByRole("region", { name: "Color grading" });
    await expect(colorDock).toBeVisible();
    await expect(colorDock.getByRole("region", { name: "Timeline overview" })).toBeVisible();
    await expect(colorDock.getByRole("slider", { name: "Timeline playhead" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole("tab", { name: "Edit" }).click();
    const mobilePanels = page.getByRole("navigation", { name: "Editor panels" });
    await expect(mobilePanels).toBeVisible();
    await mobilePanels.getByRole("button", { name: "Edit", exact: true }).click();
    const tools = page.getByRole("heading", { name: "Edit", exact: true }).locator("..");
    await expect(tools).toBeVisible();
    await expect
      .poll(() =>
        tools.evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        })),
      )
      .toMatchObject({ clientWidth: viewport.width, scrollWidth: viewport.width });
    await expectNoHorizontalOverflow(page);
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("tab", { name: "Color" }).click();
  const colorDock = page.getByRole("region", { name: "Color grading" });
  await expect(colorDock).toBeVisible();
  await expect(colorDock.getByRole("region", { name: "Timeline overview" })).toBeVisible();
  await expect(colorDock.getByRole("slider", { name: "Timeline playhead" })).toBeVisible();
  await page.getByRole("tab", { name: "Edit" }).click();
  await expect(page.getByRole("navigation", { name: "Editor panels" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Edit", exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(consoleFailures).toEqual([]);
});
