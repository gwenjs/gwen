import { expect, test } from "@playwright/test";
import { enterLevel, openExample, snap, waitForRunning } from "./probe";

test("boot reaches running and frameCount exceeds 60 two seconds later", async ({ page }) => {
  await openExample(page);
  await waitForRunning(page);
  await page.waitForTimeout(2_000);
  const shot = await snap(page);
  expect(shot?.frameCount ?? 0).toBeGreaterThan(60);
});

test("no console error, no pageerror and probe errors is empty across both scenes", async ({
  page,
}) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => {
    problems.push(error.message);
  });
  await openExample(page);
  await waitForRunning(page);
  const menu = await snap(page);
  expect(menu?.scene).toBe("menu");
  expect(menu?.errors ?? [{ level: "", code: "", message: "probe absent" }]).toEqual([]);
  await enterLevel(page);
  const enteredFrames = (await snap(page))?.frameCount ?? 0;
  await expect
    .poll(async () => ((await snap(page))?.frameCount ?? 0) - enteredFrames, {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(30);
  const level = await snap(page);
  expect(level?.errors ?? [{ level: "", code: "", message: "probe absent" }]).toEqual([]);
  expect(problems).toEqual([]);
});

test("a keyboard press on menu enters level", async ({ page }) => {
  await openExample(page);
  await waitForRunning(page);
  expect((await snap(page))?.scene).toBe("menu");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await snap(page))?.scene, { timeout: 15_000 }).toBe("level");
});

test("after one second of held ArrowRight playerX changes", async ({ page }) => {
  await openExample(page);
  await waitForRunning(page);
  await enterLevel(page);
  const before = (await snap(page))?.playerX ?? 0;
  await page.keyboard.down("ArrowRight");
  try {
    await page.waitForTimeout(1_000);
    const after = (await snap(page))?.playerX ?? 0;
    expect(after).toBeGreaterThan(before + 1);
  } finally {
    await page.keyboard.up("ArrowRight");
  }
});

test("coins are collected through the pool", async ({ page }) => {
  await openExample(page);
  await waitForRunning(page);
  await enterLevel(page);
  await page.keyboard.down("ArrowRight");
  try {
    await expect
      .poll(async () => (await snap(page))?.coinsCollected ?? 0, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1);
  } finally {
    await page.keyboard.up("ArrowRight");
  }
});

test("a collected coin is counted once when the player walks back over it", async ({ page }) => {
  await openExample(page);
  await waitForRunning(page);
  await enterLevel(page);
  await page.keyboard.down("ArrowRight");
  try {
    await expect
      .poll(async () => (await snap(page))?.coinsCollected ?? 0, { timeout: 15_000 })
      .toBe(1);
    await expect
      .poll(async () => (await snap(page))?.playerX ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(4);
    await page.keyboard.up("ArrowRight");
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(1_000);
    expect((await snap(page))?.coinsCollected).toBe(1);
  } finally {
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up("ArrowLeft");
  }
});

test("hasPhaseMs is false in the production build", async ({ page }) => {
  await openExample(page);
  await waitForRunning(page);
  const shot = await snap(page);
  expect(shot?.hasPhaseMs).toBe(false);
});

test("the chunk-loop system moves the drifter", async ({ page }) => {
  await openExample(page);
  await waitForRunning(page);
  await enterLevel(page);
  const before = (await snap(page))?.driftX ?? 0;
  await page.waitForTimeout(500);
  const after = (await snap(page))?.driftX ?? 0;
  expect(after).toBeGreaterThan(before);
});

test("a keyboard press of i on menu enters interpolation and spawns the mover and the crate", async ({
  page,
}) => {
  await openExample(page);
  await waitForRunning(page);
  // Page path: the plugin appends #platformer-canvas at the default size.
  await expect(page.locator("#platformer-canvas")).toHaveAttribute("width", "640");
  await expect(page.locator("#platformer-canvas")).toHaveAttribute("height", "360");
  const menuEntities = (await snap(page))?.entityCount ?? 0;
  await page.keyboard.press("i");
  await expect
    .poll(async () => (await snap(page))?.scene, { timeout: 15_000 })
    .toBe("interpolation");
  await expect
    .poll(async () => ((await snap(page))?.entityCount ?? 0) - menuEntities, { timeout: 15_000 })
    .toBe(2);
  expect((await snap(page))?.errors).toEqual([]);
});
