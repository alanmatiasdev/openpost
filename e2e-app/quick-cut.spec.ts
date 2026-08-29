import { expect, test } from "@playwright/test";
import { stat } from "node:fs/promises";
import path from "node:path";

declare global {
  interface Window {
    __quickCutPlayback: {
      plays: number;
      pauses: number;
      focusedButtonClicks: number;
    };
  }
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const { documentOverflows, offenders } = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = Array.from(document.body.querySelectorAll<HTMLElement>("*"))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.right > viewportWidth + 1)
      .map(({ element, rect }) => ({
        tag: element.tagName.toLowerCase(),
        label: element.getAttribute("aria-label"),
        className: element.className.toString().slice(0, 160),
        text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 120),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      }));
    return {
      documentOverflows: document.documentElement.scrollWidth > viewportWidth,
      offenders,
    };
  });
  expect(documentOverflows).toBe(false);
  expect(offenders).toEqual([]);
}

test("quick cut loads with accessible controls and no overflow at 320/390/desktop", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  for (const viewport of [
    { width: 320, height: 800 },
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/quick-cut");
    await expect(page.getByRole("heading", { name: /No video open/i })).toBeVisible();
    const openBtn = page.getByRole("button", { name: /Open videos/i });
    await expect(openBtn).toBeVisible();
    const box = await openBtn.boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalOverflow(page);
    await page.waitForTimeout(200);
    expect(errors.filter((e) => !e.includes("Failed to load resource"))).toEqual([]);
  }
});

test("quick cut imports real media, creates a range, and never fakes Send", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: undefined,
    });
    Object.assign(window, {
      __quickCutPlayback: { plays: 0, pauses: 0, focusedButtonClicks: 0 },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value(this: HTMLMediaElement) {
        window.__quickCutPlayback.plays += 1;
        this.dispatchEvent(new Event("play"));
        return Promise.resolve();
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value(this: HTMLMediaElement) {
        window.__quickCutPlayback.pauses += 1;
        this.dispatchEvent(new Event("pause"));
      },
    });
  });
  await page.goto("/quick-cut");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Open videos/i }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(
    path.resolve("frontend/src/lib/video-editor/media/fixtures/prores-proxy.mov"),
  );

  await expect(page.getByText(/prores-proxy\.mov/i).first()).toBeVisible();
  const addSource = page.getByRole("button", { name: /Add source/i });
  await addSource.evaluate((button) => {
    button.addEventListener("click", () => {
      window.__quickCutPlayback.focusedButtonClicks += 1;
    });
  });
  await addSource.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__quickCutPlayback)).toEqual({
    plays: 1,
    pauses: 0,
    focusedButtonClicks: 0,
  });
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__quickCutPlayback)).toEqual({
    plays: 1,
    pauses: 1,
    focusedButtonClicks: 0,
  });

  await page.locator("video").evaluate((video: HTMLVideoElement) => {
    video.currentTime = Math.min(0.02, video.duration || 0.02);
    video.dispatchEvent(new Event("timeupdate"));
  });
  await page.getByRole("button", { name: /^I · Mark in$/i }).click();
  await page.locator("video").evaluate((video: HTMLVideoElement) => {
    video.currentTime = Math.min(0.04, video.duration || 0.04);
    video.dispatchEvent(new Event("timeupdate"));
  });
  await page.getByRole("button", { name: /^O · Mark out$/i }).click();
  await page.getByRole("button", { name: /Add segment/i }).click();
  await expect(page.getByText("Keep at least 0.05 seconds.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Segment 1/i })).toHaveCount(0);

  await page.locator("video").evaluate((video: HTMLVideoElement) => {
    video.currentTime = Math.min(0.1, video.duration || 0.1);
    video.dispatchEvent(new Event("timeupdate"));
  });
  await page.getByRole("button", { name: /^O · Mark out$/i }).click();
  await page.getByRole("button", { name: /Add segment/i }).click();
  await expect(page.getByRole("button", { name: /Segment 1/i })).toBeVisible();

  await page.getByLabel("Mark in 1").fill("00:00.03");
  await page.getByLabel("Mark in 1").press("Tab");
  await page.getByRole("radio", { name: /Exact time/i }).click();
  await expect(
    page.getByText("Some segments require re-encoding; others can be stream copied."),
  ).toBeVisible();
  await page.getByRole("radio", { name: /Nearest keyframe/i }).click();
  await page.getByLabel("Mark in 1").fill("00:00.00");
  await page.getByLabel("Mark in 1").press("Tab");
  await expect(page.getByText("Stream copy is possible.")).toBeVisible();

  for (const viewport of [
    { width: 320, height: 800 },
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.resolve(`frontend/.svelte-kit/openpost-quick-cut-${viewport.width}.png`),
    });
  }

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.mov$/i);
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  expect((await stat(downloadedPath!)).size).toBeGreaterThan(0);

  await page.getByRole("button", { name: /Send to OpenPost/i }).click();
  await expect(page.getByText(/Choose an OpenPost workspace before sending/i)).toBeVisible();

  await page.setViewportSize({ width: 320, height: 800 });
  await expectNoHorizontalOverflow(page);
  expect(consoleErrors.filter((error) => !error.includes("Failed to load resource"))).toEqual([]);
});
