import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, it } from "vitest";
import { bootScene, type BootedScene, type Draw } from "./boot";

const MOVER_COLOR = "#1e88e5";
const CRATE_COLOR = "#8d6e63";
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

/**
 * `defineScene` runs its factory once per module, so one module boots on one engine.
 * The three behaviour cases share that single run: 10 frames of 1/120 s at the config's `physicsHz`.
 */
interface Run {
  readonly sceneName: string | undefined;
  readonly alphas: readonly number[];
  readonly renders: readonly (readonly Draw[])[];
}

let booted: BootedScene | undefined;
let run: Promise<Run> | undefined;

/** The scene module, or `undefined` while it does not exist, so a missing scene fails an assertion. */
async function loadScene(): Promise<typeof import("../src/scenes/interpolation") | undefined> {
  return import("../src/scenes/interpolation").catch(() => undefined);
}

function sharedRun(): Promise<Run> {
  run ??= (async (): Promise<Run> => {
    const loaded = await loadScene();
    if (loaded === undefined) return { sceneName: undefined, alphas: [], renders: [] };
    booted = await bootScene(loaded.interpolation);
    await booted.handle.advance(10, 1 / 120);
    return {
      sceneName: loaded.interpolation.sceneName,
      alphas: booted.alphas,
      renders: booted.recorder.renders,
    };
  })();
  return run;
}

afterAll(async () => {
  await booted?.handle.dispose();
});

/** The draw of `color` in each render, in render order. */
function drawsOf(renders: readonly (readonly Draw[])[], color: string): Draw[] {
  const picked: Draw[] = [];
  for (const render of renders) {
    const draw = render.find((item) => item.color === color);
    if (draw !== undefined) picked.push(draw);
  }
  return picked;
}

it("the reference scene runs at physicsHz 60", async () => {
  const result = await sharedRun();
  expect(result.sceneName).toBe("interpolation");
  // 120 Hz frames on a 60 Hz fixed step: every other render runs a step (alpha 0).
  expect(result.alphas).toEqual([0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0]);
});

it("the mover is drawn between fixed steps at 120 Hz", async () => {
  const result = await sharedRun();
  expect(result.sceneName).toBe("interpolation");
  const xs = drawsOf(result.renders, MOVER_COLOR).map((draw) => draw.x);
  // The mover starts at world x -5 and moves 3 units per second: 2 pixels per 1/60 s step.
  // Its box is 1 unit (40 px) wide, centred on a 640 px canvas: left edge 320 - 200 - 20 = 100.
  // Same series as core's `render-interpolation.test.ts`: 0, 0, 0, 0, 0.5, 1, ... steps.
  const steps = [0, 0, 0, 0, 0.5, 1, 1.5, 2, 2.5, 3];
  expect(xs).toHaveLength(steps.length);
  for (let index = 0; index < steps.length; index += 1) {
    expect(xs[index]).toBeCloseTo(100 + 2 * (steps[index] ?? Number.NaN), 3);
  }
});

it("the falling crate is drawn between two physics steps", async () => {
  const result = await sharedRun();
  expect(result.sceneName).toBe("interpolation");
  const ys = drawsOf(result.renders, CRATE_COLOR).map((draw) => draw.y);
  // The crate never calls `useTransform()`: it is drawn on every render because its body owns the node.
  expect(readFileSync(path.join(SRC, "actors", "Crate.ts"), "utf8")).not.toContain("useTransform");
  expect(ys).toHaveLength(10);
  // Canvas y grows downward. From the first step on, no two renders draw the same y.
  for (let index = 2; index < ys.length; index += 1) {
    expect(ys[index]).toBeGreaterThan(ys[index - 1] ?? Number.NaN);
  }
  // A render at alpha 0.5 sits halfway between the two alpha 0 renders around it.
  for (let index = 2; index + 1 < ys.length; index += 2) {
    const before = ys[index - 1] ?? Number.NaN;
    const after = ys[index + 1] ?? Number.NaN;
    expect(ys[index]).toBeCloseTo((before + after) / 2, 6);
  }
});

/** Every `.ts` file under `dir`, relative to `SRC`. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts")) found.push(path.relative(SRC, full));
  }
  return found;
}

it("the canvas renderer reads poses only through transform:2d", () => {
  const files = sourceFiles(SRC);
  expect(files).toContain(path.join("scenes", "interpolation.ts"));
  for (const file of files) {
    const text = readFileSync(path.join(SRC, file), "utf8");
    expect(text, file).not.toMatch(
      /readInterpolatedTransform2D|transforms2D|@gwenjs\/core\/internal/,
    );
  }
  const renderer = readFileSync(path.join(SRC, "plugins", "render-canvas2d.ts"), "utf8");
  expect(renderer).toContain('inject("transform:2d")');
});
