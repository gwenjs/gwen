import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import type { GwenHarness, IsolatedBatch } from "./fixtures/isolated-entry";

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

function playwrightVersion(): string {
  const required: unknown = createRequire(import.meta.url)("@playwright/test/package.json");
  if (typeof required !== "object" || required === null) {
    throw new Error("Playwright package.json is not an object.");
  }
  const version: unknown = Reflect.get(required, "version");
  if (typeof version !== "string") {
    throw new Error("Playwright package.json has no string version.");
  }
  return version;
}

test.beforeAll(async ({ browser }) => {
  log(`browser.version()=${browser.version()}`);
  log(`@playwright/test=${playwrightVersion()}`);
});

async function openIsolated(page: Page): Promise<void> {
  await page.goto("/isolated/");
  await page.waitForFunction(() => document.body.dataset.ready === "1");
}

interface Exhausted {
  successes: number;
  failed: boolean;
  advanced: boolean;
  secondOk: boolean;
  sameMemory: boolean;
  code: string;
  name: string;
  message: string;
}

function exhaustShared(page: Page, cap: number): Promise<Exhausted> {
  return page.evaluate(async (limit) => {
    const gwen: GwenHarness = window.__gwen;
    await gwen.makeShared();
    let successes = 0;
    let code = "";
    let name = "";
    let message = "";
    for (let i = 0; i < limit; i += 1) {
      const made = await gwen.makeIsolated(i);
      if (!made.ok) {
        code = made.code ?? "";
        name = made.name ?? "";
        message = made.message ?? "";
        break;
      }
      successes += 1;
    }
    const report: Exhausted = {
      successes,
      failed: code !== "",
      advanced: false,
      secondOk: false,
      sameMemory: false,
      code,
      name,
      message,
    };
    const first = gwen.state().shared[0];
    if (first === undefined) return report;
    const prior = first.frameCount();
    await first.advance(1 / 60);
    const second = await gwen.makeShared();
    const memory0 = first.getLinearMemory();
    const other = gwen.state().shared[1];
    const memory1 = other === undefined ? null : other.getLinearMemory();
    report.advanced = first.frameCount() === prior + 1;
    report.secondOk = second.ok;
    report.sameMemory = memory0 !== null && memory1 !== null && memory0 === memory1;
    return report;
  }, cap);
}

function expectExhausted(result: Exhausted, bound: number): void {
  const detail = `${result.name}: ${result.message}`;
  expect(result.failed, detail).toBe(true);
  expect(result.successes, detail).toBeGreaterThanOrEqual(1);
  expect(result.successes + 1, `failing engine index; ${detail}`).toBeLessThanOrEqual(bound);
  expect(result.code, detail).toBe("CORE:WASM_CAPACITY_EXHAUSTED");
  expect(result.advanced, detail).toBe(true);
  expect(result.secondOk, detail).toBe(true);
  expect(result.sameMemory, detail).toBe(true);
}

function logExhausted(browser: string, result: Exhausted): void {
  log(
    `${browser} isolated successes=${String(result.successes)} failing engine index=${String(result.successes + 1)} code=${result.code} name=${result.name} message=${result.message}`,
  );
}

test.describe("chromium", () => {
  test.skip(({ browserName }) => browserName !== "chromium");

  test("chromium: isolated engines exhaust at or before 125 with CORE:WASM_CAPACITY_EXHAUSTED", async ({
    page,
  }) => {
    // CI run 41059346720, chromium: 229 ms. Timeout is 2x.
    test.setTimeout(460);
    await openIsolated(page);
    const result = await exhaustShared(page, 200);
    logExhausted("chromium", result);
    expectExhausted(result, 125);
  });
});

test.describe("firefox", () => {
  test.skip(({ browserName }) => browserName !== "firefox");

  test("firefox: isolated engines exhaust at or before 1000 with CORE:WASM_CAPACITY_EXHAUSTED", async ({
    page,
  }) => {
    // CI run 41059346720, firefox: 5.2 s. Timeout is 2x.
    test.setTimeout(10_400);
    await openIsolated(page);
    const result = await exhaustShared(page, 1100);
    logExhausted("firefox", result);
    expectExhausted(result, 1000);
  });
});

test.describe("webkit", () => {
  test.skip(({ browserName }) => browserName !== "webkit");

  test("webkit: 500 isolated engines, no crash, independent counts", async ({ page }) => {
    // CI run 41059346720, webkit: 3.5 s. Timeout is 2x.
    test.setTimeout(7_000);
    await openIsolated(page);
    const opened: IsolatedBatch = await page.evaluate(async () => {
      const gwen: GwenHarness = window.__gwen;
      return gwen.collectIsolated(500);
    });
    log(
      `webkit isolated opened=${String(opened.counts.length)} distinctMemories=${String(opened.distinctMemories)} nullMemories=${String(opened.nullMemories)} failedAt=${String(opened.failedAt)} code=${opened.code} name=${opened.name} message=${opened.message}`,
    );
    expect(opened.failedAt, `${opened.code} ${opened.name}: ${opened.message}`).toBeUndefined();
    expect(opened.nullMemories).toBe(0);
    expect(opened.distinctMemories).toBe(500);
    expect(opened.counts).toHaveLength(500);
    expect(opened.counts.findIndex((count, index) => count !== index % 7)).toBe(-1);
  });

  test("webkit: per-tick step time of isolated engines 9-16 against 1-8", async ({
    page,
  }, testInfo) => {
    // CI run 41059346720, webkit: 1.2 s. Timeout is 2x.
    test.setTimeout(2_400);
    await openIsolated(page);
    const result = await page.evaluate(async () => {
      const gwen: GwenHarness = window.__gwen;
      return gwen.measurePhysicsSteps();
    });
    log(`webkit step median engines1-8=${String(result.early)} engines9-16=${String(result.late)}`);
    writeFileSync(
      testInfo.outputPath("capacity-webkit.json"),
      `${JSON.stringify({ early: result.early, late: result.late })}\n`,
    );
    expect(Number.isFinite(result.early)).toBe(true);
    expect(result.early).toBeGreaterThan(0);
    expect(Number.isFinite(result.late)).toBe(true);
    expect(result.late).toBeGreaterThan(0);
  });
});
