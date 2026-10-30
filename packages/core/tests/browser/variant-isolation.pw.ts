import { expect, test } from "@playwright/test";

test("a light engine requests no physics URL", async ({ page }) => {
  const urls: string[] = [];
  page.on("request", (request) => {
    urls.push(request.url());
  });

  await page.goto("/light/");
  // An empty body has no box, so Playwright treats it as hidden.
  await page.waitForFunction(() => document.body.dataset.result !== undefined);
  const result = await page.evaluate(() => document.body.dataset.result);

  const physics = urls.filter((url) => url.includes("physics2d") || url.includes("physics3d"));
  expect(physics).toEqual([]);
  expect(urls).toEqual(
    expect.arrayContaining([
      expect.stringContaining("/wasm/light/gwen_core_factory.js"),
      expect.stringContaining("/wasm/light/gwen_core_bg.wasm"),
    ]),
  );
  expect(JSON.parse(result ?? "null")).toEqual({ ok: true, entities: 1 });
});
