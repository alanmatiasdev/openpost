import { expect, test, type Page } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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
      page.evaluate(
        () =>
          document.body.scrollWidth <= window.innerWidth &&
          document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

async function expectMinimumTargets(
  locator: ReturnType<Page["getByRole"]>,
  minimum = 44,
): Promise<void> {
  await expect
    .poll(() =>
      locator.evaluateAll(
        (elements, min) =>
          elements.length > 0 &&
          elements.every((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.width >= min && bounds.height >= min;
          }),
        minimum,
      ),
    )
    .toBe(true);
}

async function createProject(page: Page, name: string): Promise<void> {
  await installLocalWorkspacePicker(page);
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Choose folder" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+$/u);
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
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
  await createProject(page, "Responsive route proof");

  for (const viewport of [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expectMinimumTargets(
      page.getByRole("tablist", { name: "Editor workspaces" }).getByRole("tab"),
    );
    await page.getByRole("tab", { name: "Color" }).click();
    const colorDock = page.getByRole("region", { name: "Color grading" });
    await expect(colorDock).toBeVisible();
    await expect(colorDock.getByRole("region", { name: "Timeline overview" })).toBeVisible();
    await expect(colorDock.getByRole("slider", { name: "Timeline playhead" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole("tab", { name: "Edit" }).click();
    const mobilePanels = page.getByRole("navigation", {
      name: "Editor panels",
    });
    await expect(mobilePanels).toBeVisible();
    await expectMinimumTargets(mobilePanels.getByRole("button"));
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
      .toMatchObject({
        clientWidth: viewport.width,
        scrollWidth: viewport.width,
      });
    const inspector = page.getByRole("complementary", { name: "Edit" });
    const sendBounds = await inspector
      .getByRole("button", { name: "Send to OpenPost" })
      .boundingBox();
    const timelineBounds = await page
      .getByText("Timeline", { exact: true })
      .locator("..")
      .boundingBox();
    expect(sendBounds).not.toBeNull();
    expect(timelineBounds).not.toBeNull();
    expect(sendBounds!.y + sendBounds!.height).toBeLessThanOrEqual(timelineBounds!.y);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `frontend/.svelte-kit/openpost-video-editor-${viewport.width}.png`,
      fullPage: true,
    });
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

  await page.getByRole("button", { name: "Add text" }).click();
  const inspector = page.getByRole("complementary", { name: "Edit" });
  await expect(inspector.getByRole("heading", { name: "Properties" })).toBeVisible();
  const inspectorBounds = await inspector.boundingBox();
  expect(inspectorBounds).not.toBeNull();
  for (const name of [
    "Split at playhead (B)",
    "Delete and leave gap",
    "Ripple delete",
    "Create compound clip",
    "Add crossfade",
  ]) {
    const button = inspector.getByRole("button", { name });
    const bounds = await button.boundingBox();
    expect(bounds, `${name} should be visible inside the inspector`).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(inspectorBounds!.x);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
      inspectorBounds!.x + inspectorBounds!.width,
    );
    await expect
      .poll(() =>
        button.evaluate(
          (element) =>
            element.scrollWidth <= element.clientWidth &&
            element.scrollHeight <= element.clientHeight,
        ),
      )
      .toBe(true);
  }
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: "frontend/.svelte-kit/openpost-video-editor-1280.png",
    fullPage: true,
  });
  expect(consoleFailures).toEqual([]);
});

test("Video Editor keyboard transport and delete commands survive focused controls", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await createProject(page, "Keyboard route proof");

  const addText = page.getByRole("button", { name: "Add text" });
  const clips = page.locator("[data-timeline-item-id]");
  await addText.click();
  await expect(clips).toHaveCount(1);

  await addText.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(clips).toHaveCount(1);
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(clips).toHaveCount(1);

  const playhead = page.getByRole("slider", { name: "Timeline playhead" });
  await playhead.focus();
  await page.keyboard.press("End");
  await addText.click();
  await expect(clips).toHaveCount(2);

  await clips.nth(1).locator(":scope > button").first().click();
  await page.keyboard.press("Backspace");
  await expect(clips).toHaveCount(1);

  await addText.click();
  await expect(clips).toHaveCount(2);
  const firstLeft = await clips
    .nth(0)
    .evaluate((clip) => parseFloat((clip as HTMLElement).style.left));
  const secondLeft = await clips
    .nth(1)
    .evaluate((clip) => parseFloat((clip as HTMLElement).style.left));
  expect(secondLeft).toBeGreaterThan(firstLeft);

  await clips.nth(0).locator(":scope > button").first().click();
  await page.keyboard.press("Delete");
  await expect(clips).toHaveCount(1);
  await expect
    .poll(() => clips.nth(0).evaluate((clip) => parseFloat((clip as HTMLElement).style.left)))
    .toBe(firstLeft);
});

test("Video Editor restores its workspace before reloading a project deep link", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await createProject(page, "Reload route proof");

  const projectUrl = page.url();
  await page.reload();

  await expect(page).toHaveURL(projectUrl);
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
  await expect(page.getByText("Workspace root is not set")).toBeHidden();
});

test("Video Editor restores its workspace before a direct new-project handoff", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await createProject(page, "Workspace seed");

  await page.goto("about:blank");
  await page.goto("/video-editor/new?name=Direct%20handoff&return=draft-123");

  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+\?return=draft-123$/u);
  await expect(page.getByText("Direct handoff")).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
});

test("Video Editor quick export saves an MP4 in the workspace", async ({ page }) => {
  test.setTimeout(90_000);
  const projectName = "Quick export proof";
  await createProject(page, projectName);
  await page.getByRole("button", { name: "Add text" }).click();

  const exportButton = page.getByRole("button", { name: "Export MP4" });
  await exportButton.click();
  await expect(page.getByText(`Saved ${projectName}.mp4 to the exports folder.`)).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("button", { name: "Exports" }).click();
  await expect(page.getByText(`${projectName}.mp4`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Download ${projectName}.mp4` })).toBeEnabled();
});

test("Video Editor sends a rendered export into a new composer", async ({ page, request }) => {
  test.setTimeout(90_000);
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `video-editor-send-${unique}@example.com`);
  await createWorkspace(request, auth.token, "Video Editor send E2E");
  await authenticatePage(page, auth.token);
  await createProject(page, "Composer send proof");
  await page.getByRole("button", { name: "Add text" }).click();

  await page.getByRole("button", { name: "Send to OpenPost" }).click();
  await expect(
    page.getByRole("status").getByText("Sent to your OpenPost media library."),
  ).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("link", { name: "Open composer" }).click();
  await expect(page.locator("[data-composer-media-id]")).toHaveCount(1);
  await expect(page).toHaveURL(/\/$/u);
});
