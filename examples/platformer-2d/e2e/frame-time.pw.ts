import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { enterLevel, openExample, snap, waitForRunning } from "./probe";

test("the frame time of the level is written to dist/probe.json for the report", async ({
  page,
}) => {
  await openExample(page);
  await waitForRunning(page);
  await enterLevel(page);
  await page.waitForTimeout(2_000);
  const shot = await snap(page);
  expect(shot?.fps ?? 0, "fps is a positive number").toBeGreaterThan(0);
  expect(shot?.rawFrameTimeMs ?? 0, "rawFrameTimeMs is a positive number").toBeGreaterThan(0);
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(
    path.join(dist, "probe.json"),
    `${JSON.stringify({ fps: shot?.fps, rawFrameTimeMs: shot?.rawFrameTimeMs })}\n`,
  );
});
