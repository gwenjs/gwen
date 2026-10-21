import { expect, test } from "@playwright/test";

test("a quote in the jsUrl fragment runs no injected statement", async ({ page }) => {
  await page.goto("/quote/");
  // An empty body has no box, so Playwright treats it as hidden.
  await page.waitForFunction(() => document.body.dataset.result !== undefined);

  const result = await page.evaluate(() => document.body.dataset.result);
  const pwned = await page.evaluate(() => Reflect.get(globalThis, "PWNED"));

  expect(pwned).toBeUndefined();
  expect(JSON.parse(result ?? "null")).toEqual({ ok: true, entities: 1 });
});
