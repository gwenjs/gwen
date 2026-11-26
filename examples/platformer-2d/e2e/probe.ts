import { expect, type Page } from "@playwright/test";

declare global {
  interface Window {
    __gwenProbe?: { snapshot(): ProbeSnapshot };
  }
}

/** Fields the example probe publishes on `window.__gwenProbe`. */
export interface ProbeSnapshot {
  state: string;
  scene: string | null;
  frameCount: number;
  entityCount: number;
  errors: readonly { level: string; code: string; message: string }[];
  hasPhaseMs: boolean | undefined;
  coinsCollected: number;
  playerX: number;
  driftX: number;
}

function serverReachable(): boolean {
  const raw = process.env["GWEN_EXAMPLE_SERVER"] ?? "";
  return raw.includes('"reachable":true');
}

/** Fail on the server assertion before the page is opened. */
export async function openExample(page: Page): Promise<void> {
  expect(serverReachable(), "the example server answered").toBe(true);
  await page.goto("/");
}

function booleanField(source: object, key: string): boolean | undefined {
  const value: unknown = Reflect.get(source, key);
  return typeof value === "boolean" ? value : undefined;
}

function numberField(source: object, key: string): number {
  const value: unknown = Reflect.get(source, key);
  return typeof value === "number" ? value : Number.NaN;
}

function stringField(source: object, key: string): string {
  const value: unknown = Reflect.get(source, key);
  return typeof value === "string" ? value : "";
}

function errorList(source: object): ProbeSnapshot["errors"] {
  const value: unknown = Reflect.get(source, "errors");
  if (!Array.isArray(value)) return [];
  const errors: { level: string; code: string; message: string }[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    errors.push({
      level: stringField(entry, "level"),
      code: stringField(entry, "code"),
      message: stringField(entry, "message"),
    });
  }
  return errors;
}

/** Read the probe. `undefined` when the page never published one. */
export async function snap(page: Page): Promise<ProbeSnapshot | undefined> {
  const value: unknown = await page.evaluate(() => {
    const probe = window.__gwenProbe;
    if (probe === undefined) return undefined;
    return probe.snapshot();
  });
  if (typeof value !== "object" || value === null) return undefined;
  const sceneValue: unknown = Reflect.get(value, "scene");
  return {
    state: stringField(value, "state"),
    scene: typeof sceneValue === "string" ? sceneValue : null,
    frameCount: numberField(value, "frameCount"),
    entityCount: numberField(value, "entityCount"),
    errors: errorList(value),
    hasPhaseMs: booleanField(value, "hasPhaseMs"),
    coinsCollected: numberField(value, "coinsCollected"),
    playerX: numberField(value, "playerX"),
    driftX: numberField(value, "driftX"),
  };
}

export async function waitForRunning(page: Page): Promise<void> {
  await expect.poll(async () => (await snap(page))?.state, { timeout: 15_000 }).toBe("running");
}

export async function enterLevel(page: Page): Promise<void> {
  expect((await snap(page))?.scene).toBe("menu");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await snap(page))?.scene, { timeout: 15_000 }).toBe("level");
}
