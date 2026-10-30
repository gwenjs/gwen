import { expect, test, type Page } from "@playwright/test";
import type { GwenHarness } from "./fixtures/isolated-entry";

async function openIsolated(page: Page): Promise<void> {
  await page.goto("/isolated/");
  await page.waitForFunction(() => document.body.dataset.ready === "1");
}

test("two isolated engines have different memory objects", async ({ page }) => {
  await openIsolated(page);
  const result = await page.evaluate(async () => {
    const gwen: GwenHarness = window.__gwen;
    await gwen.makeIsolated(3);
    await gwen.makeIsolated(0);
    const first = gwen.state().isolated[0];
    const second = gwen.state().isolated[1];
    if (first === undefined || second === undefined) {
      return { different: false, countA: -1, countB: -1 };
    }
    const memoryA = first.getLinearMemory();
    const memoryB = second.getLinearMemory();
    return {
      different: memoryA !== null && memoryB !== null && memoryA !== memoryB,
      countA: first.countEntities(),
      countB: second.countEntities(),
    };
  });
  expect(result.different).toBe(true);
  expect(result.countA).toBe(3);
  expect(result.countB).toBe(0);
});
