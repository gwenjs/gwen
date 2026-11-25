/**
 * #69: `gwen:hoist-chunk-columns` must not change a result, and must not skip work.
 * The source fixture and its committed golden run on two real engines, 10 000 entities x 120
 * frames. Three checks, per column:
 * - the two engines hold the same values under `Object.is`;
 * - both engines equal a plain JS reference (`Math.fround` after each of the 120 steps), so two
 *   systems that are equally wrong still fail;
 * - every entity moved, and each engine holds exactly 10 000 rows of `Position` + `Velocity`.
 * The fixtures load through a dynamic `import()` after an existence assertion. A static import
 * of a file the PR adds would let `verify-red.sh` rerun this file with the golden present.
 */

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import type * as ComponentsNamespace from "../../bench/fixtures/system-iteration.components";
import type * as SystemNamespace from "../../bench/fixtures/system-iteration.source";
import type { EntityId } from "../../src/types/entity.js";
import { createRealEngine } from "./harness.js";

type ComponentsModule = typeof ComponentsNamespace;
type SystemModule = typeof SystemNamespace;

const ENTITIES = 10_000;
const FRAMES = 120;
const DT = 1 / 60;

const COLUMNS = ["x", "y", "vx", "vy"] as const;

interface Columns {
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
}

function emptyColumns(): Columns {
  return {
    x: new Float32Array(ENTITIES),
    y: new Float32Array(ENTITIES),
    vx: new Float32Array(ENTITIES),
    vy: new Float32Array(ENTITIES),
  };
}

/** The seeds, stored through `Float32Array` so they are the f32 values the engine holds. */
function seeds(): Columns {
  const seed = emptyColumns();
  for (let i = 0; i < ENTITIES; i++) {
    seed.x[i] = i * 0.37;
    seed.y[i] = -i * 0.11;
    seed.vx[i] = 1 + (i % 7) * 0.3;
    seed.vy[i] = 0.5 - (i % 5) * 0.2;
  }
  return seed;
}

/** `x = fround(x + vx * dt)` for `FRAMES` steps, in plain JS: independent of the engine. */
function reference(seed: Columns): Columns {
  const expected = emptyColumns();
  for (let i = 0; i < ENTITIES; i++) {
    const vx = seed.vx[i] ?? 0;
    const vy = seed.vy[i] ?? 0;
    let x = seed.x[i] ?? 0;
    let y = seed.y[i] ?? 0;
    for (let frame = 0; frame < FRAMES; frame++) {
      x = Math.fround(x + vx * DT);
      y = Math.fround(y + vy * DT);
    }
    expected.x[i] = x;
    expected.y[i] = y;
    expected.vx[i] = vx;
    expected.vy[i] = vy;
  }
  return expected;
}

/** First index where the two columns differ under `Object.is`, or -1. */
function firstDifference(actual: Float32Array, expected: Float32Array): number {
  for (let i = 0; i < expected.length; i++) {
    if (!Object.is(actual[i], expected[i])) return i;
  }
  return -1;
}

/** First index where the column still equals its seed, or -1. */
function firstUnchanged(actual: Float32Array, seed: Float32Array): number {
  for (let i = 0; i < seed.length; i++) {
    if (Object.is(actual[i], seed[i])) return i;
  }
  return -1;
}

function isComponentsModule(value: unknown): value is ComponentsModule {
  return typeof value === "object" && value !== null && "Position" in value && "Velocity" in value;
}

function isSystemModule(value: unknown): value is SystemModule {
  return typeof value === "object" && value !== null && "Mover" in value;
}

function fixtureFile(name: string): string {
  return fileURLToPath(new URL(`../../bench/fixtures/${name}.ts`, import.meta.url));
}

async function loadFixture(name: string, label: string): Promise<unknown> {
  const file = fixtureFile(name);
  expect(existsSync(file), `the committed ${label} fixture exists`).toBe(true);
  return import(/* @vite-ignore */ pathToFileURL(file).href);
}

interface Outcome {
  /** Rows of the `Position` + `Velocity` query before the first frame. */
  rowsBefore: number;
  rowsAfter: number;
  /** Entities with no `Position` or no `Velocity` when read back by id. */
  unreadable: number;
  columns: Columns;
}

async function runSystem(
  components: ComponentsModule,
  system: SystemModule,
  seed: Columns,
): Promise<Outcome> {
  const { Position, Velocity } = components;
  const handle = await createRealEngine({ variant: "light", maxEntities: ENTITIES + 64 });
  try {
    const { engine } = handle;
    const ids: EntityId[] = [];
    for (let i = 0; i < ENTITIES; i++) {
      const id = engine.createEntity();
      engine.addComponent(id, Position, { x: seed.x[i] ?? 0, y: seed.y[i] ?? 0 });
      engine.addComponent(id, Velocity, { vx: seed.vx[i] ?? 0, vy: seed.vy[i] ?? 0 });
      ids.push(id);
    }
    const query = engine.createQuery([Position, Velocity]);
    const countRows = (): number => {
      let rows = 0;
      for (const chunk of query) rows += chunk.count;
      return rows;
    };
    const rowsBefore = countRows();
    await engine.use(system.Mover());
    await handle.advance(FRAMES, DT);
    const rowsAfter = countRows();

    const columns = emptyColumns();
    let unreadable = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const position = id === undefined ? undefined : engine.getComponent(id, Position);
      const velocity = id === undefined ? undefined : engine.getComponent(id, Velocity);
      if (position === undefined || velocity === undefined) {
        unreadable += 1;
        continue;
      }
      columns.x[i] = position.x;
      columns.y[i] = position.y;
      columns.vx[i] = velocity.vx;
      columns.vy[i] = velocity.vy;
    }
    return { rowsBefore, rowsAfter, unreadable, columns };
  } finally {
    await handle.dispose();
  }
}

describe("hoisted chunk columns on real WASM (#69)", () => {
  it("positions and velocities are bitwise equal after 120 frames", async () => {
    const goldenModule = await loadFixture("system-iteration.optimized", "golden");
    const sourceModule = await loadFixture("system-iteration.source", "source");
    const componentsModule = await loadFixture("system-iteration.components", "components");
    if (!isSystemModule(goldenModule)) throw new Error("the golden exports no Mover");
    if (!isSystemModule(sourceModule)) throw new Error("the source exports no Mover");
    if (!isComponentsModule(componentsModule)) throw new Error("the components fixture is wrong");

    const seed = seeds();
    for (const column of ["vx", "vy"] as const) {
      expect(seed[column].includes(0), `every ${column} seed is non-zero`).toBe(false);
    }
    const expected = reference(seed);

    const plain = await runSystem(componentsModule, sourceModule, seed);
    const hoisted = await runSystem(componentsModule, goldenModule, seed);

    for (const [label, outcome] of [
      ["source", plain],
      ["golden", hoisted],
    ] as const) {
      expect(outcome.rowsBefore, `${label} rows before the first frame`).toBe(ENTITIES);
      expect(outcome.rowsAfter, `${label} rows after ${FRAMES} frames`).toBe(ENTITIES);
      expect(outcome.unreadable, `${label} entities without Position or Velocity`).toBe(0);
    }

    for (const column of COLUMNS) {
      expect(firstDifference(hoisted.columns[column], plain.columns[column]), column).toBe(-1);
    }
    for (const [label, outcome] of [
      ["source", plain],
      ["golden", hoisted],
    ] as const) {
      for (const column of COLUMNS) {
        expect(
          firstDifference(outcome.columns[column], expected[column]),
          `${label} ${column} against the JS f32 reference`,
        ).toBe(-1);
      }
      for (const column of ["x", "y"] as const) {
        expect(
          firstUnchanged(outcome.columns[column], seed[column]),
          `${label} ${column} moved on every entity`,
        ).toBe(-1);
      }
    }
  });
});
