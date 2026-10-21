import { expect, test } from "@playwright/test";

const CSP = "script-src 'self' 'wasm-unsafe-eval'";

test("engine initialises under script-src 'self' 'wasm-unsafe-eval'", async ({ page }) => {
  const response = await page.goto("/csp/");
  expect(response?.headers()["content-security-policy"]).toBe(CSP);

  // An empty body has no box, so Playwright treats it as hidden.
  await page.waitForFunction(() => document.body.dataset.result !== undefined);
  const result = await page.evaluate(() => document.body.dataset.result);

  expect(JSON.parse(result ?? "null")).toEqual({ ok: true, entities: 1 });
});
